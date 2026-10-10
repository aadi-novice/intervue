"""
Internal endpoints for the notetaker bot and the transcriber. HMAC-authenticated, must not be
routed through the public gateway (see docs/DEPLOYMENT.md).
"""

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.core import security
from app.core.config import settings
from app.db.dependencies import get_db
from app.models.job import Job
from app.services import bot_service, recording_service

router = APIRouter(prefix="/internal", tags=["Internal"], include_in_schema=False)


async def _verified_body(request: Request, secret: str) -> bytes:
    body = await request.body()
    if not security.verify_signature(
        secret, body, request.headers.get("x-timestamp"), request.headers.get("x-signature")
    ):
        raise api_error(401, "Invalid signature", "bad_signature")
    return body


async def _bot_session(session_id: int, request: Request, db: Session):
    session = bot_service.get_session(db, session_id)
    # Same error for "unknown session" and "bad signature": no session enumeration.
    secret = security.derive_bot_secret(session_id)
    body = await _verified_body(request, secret)
    if session is None:
        raise api_error(401, "Invalid signature", "bad_signature")
    return session, body


@router.post("/bots/{session_id}/events")
async def bot_events(session_id: int, request: Request, db: Session = Depends(get_db)):
    session, body = await _bot_session(session_id, request, db)
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
    except ValueError:
        raise api_error(422, "Body must be a JSON object", "bad_body")
    try:
        bot_service.handle_event(db, session, payload)
    except Exception as e:
        from app.core.errors import DomainError

        db.rollback()
        if isinstance(e, DomainError):
            raise api_error(e.status, e.detail, e.code)
        raise
    return {"ok": True}


@router.post("/bots/{session_id}/upload-url")
async def bot_upload_url(session_id: int, request: Request, db: Session = Depends(get_db)):
    session, body = await _bot_session(session_id, request, db)
    try:
        data = json.loads(body)
        return bot_service.upload_url(session, data["blob"], data["content_type"])
    except (ValueError, KeyError, TypeError):
        raise api_error(422, "blob and content_type are required", "bad_body")
    except Exception as e:
        from app.core.errors import DomainError

        if isinstance(e, DomainError):
            raise api_error(e.status, e.detail, e.code)
        raise


@router.get("/bots/{session_id}/control")
async def bot_control(session_id: int, request: Request, db: Session = Depends(get_db)):
    session, _ = await _bot_session(session_id, request, db)
    return {"action": bot_service.control_action(session)}


@router.post("/transcriber/callback")
async def transcriber_callback(request: Request, db: Session = Depends(get_db)):
    body = await _verified_body(request, settings.transcriber_callback_secret)
    try:
        data = json.loads(body)
        interview_id, job_id = recording_service.parse_job_id(data["job_id"])
    except (ValueError, KeyError, TypeError):
        raise api_error(422, "Invalid callback body", "bad_body")
    job = db.get(Job, job_id)
    if job is None or job.entity_id != interview_id or job.kind != recording_service.TRANSCRIPTION:
        raise api_error(404, "Unknown job", "not_found")
    if recording_service.store_transcription_result(db, job, data):
        from app.worker.tasks.bots import finish_transcription_task

        finish_transcription_task.delay(job.org_id, job.id)
    return {"ok": True}
