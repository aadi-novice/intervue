from datetime import datetime

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context, require_role
from app.api.limits import limit_org, limit_user
from app.core import storage
from app.core.config import settings
from app.core.errors import NotFound
from app.db.dependencies import get_db
from app.models.analysis import Analysis
from app.models.interview import Recording
from app.schemas.analysis import AnalysisResponse, AnalysisStatusResponse
from app.schemas.interview import (
    BotRequest,
    BotSessionOut,
    InterviewCreate,
    InterviewDetail,
    InterviewSummary,
    RecordingUploadComplete,
    RecordingUploadRequest,
    RecordingUploadResponse,
    RecordingUrl,
    SegmentOut,
    SegmentPage,
    SpeakerMappingRequest,
)
from app.services import (
    analysis_service,
    audit_service,
    bot_service,
    recording_service,
    interview_service,
    job_service,
    transcript_service,
)

router = APIRouter(prefix="/interviews", tags=["Interviews"])


@router.post("", status_code=201, response_model=InterviewDetail)
def create_interview(
    body: InterviewCreate,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    iv = interview_service.create_interview(db, ctx, body)
    return interview_service.detail(db, ctx, iv)


@router.get("", response_model=list[InterviewSummary])
def list_interviews(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    role_id: int | None = None,
    candidate_id: int | None = None,
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return interview_service.list_interviews(db, ctx, from_, to, role_id, candidate_id)


@router.get("/{interview_id}", response_model=InterviewDetail)
def get_interview(
    interview_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    iv = interview_service.get_interview(db, ctx, interview_id)
    return interview_service.detail(db, ctx, iv)


@router.post("/{interview_id}/cancel", response_model=InterviewSummary)
def cancel_interview(
    interview_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return interview_service.summary(db, interview_service.cancel(db, ctx, interview_id))


@router.post(
    "/{interview_id}/upload",
    dependencies=[Depends(limit_user("upload", "limit_uploads_per_hour"))],
)
def upload(
    interview_id: int,
    file: UploadFile = File(...),
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return interview_service.upload_to_interview(db, ctx, interview_id, file)


@router.get("/{interview_id}/transcript", response_model=SegmentPage)
def transcript(
    interview_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    interview_service.get_interview(db, ctx, interview_id)
    items, total = transcript_service.list_segments(db, interview_id, ctx.org_id, offset, limit)
    return SegmentPage(
        items=[SegmentOut.model_validate(s) for s in items], total=total, offset=offset, limit=limit
    )


@router.patch("/{interview_id}/speakers", response_model=InterviewDetail)
def map_speakers(
    interview_id: int,
    body: SpeakerMappingRequest,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    iv = interview_service.get_interview(db, ctx, interview_id)
    transcript_service.map_speakers(db, ctx, iv, body.mappings)
    db.refresh(iv)
    return interview_service.detail(db, ctx, iv)


@router.get("/{interview_id}/recording", response_model=RecordingUrl)
def recording(
    interview_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    interview_service.get_interview(db, ctx, interview_id)
    rec = (
        db.query(Recording)
        .filter(Recording.interview_id == interview_id, Recording.org_id == ctx.org_id)
        .order_by(Recording.id.desc())
        .first()
    )
    if rec is None:
        raise NotFound("No recording for this interview", "no_recording")
    audit_service.record(db, ctx, "recording.accessed", "interview", interview_id, recording_id=rec.id)
    db.commit()
    ttl = min(settings.s3_presign_ttl_seconds, 900)
    return RecordingUrl(
        url=storage.presigned_get(rec.blob_path, ttl),
        expires_in=ttl,
        mime_type=rec.mime_type,
        duration_ms=rec.duration_ms,
    )


@router.post(
    "/{interview_id}/analysis",
    status_code=202,
    response_model=AnalysisStatusResponse,
    dependencies=[Depends(limit_org("analysis", "limit_analysis_per_hour"))],
)
def request_analysis(
    interview_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    job = analysis_service.request_interview_analysis(db, ctx, interview_id)
    return AnalysisStatusResponse(status="queued", job_id=job.id)


@router.get("/{interview_id}/analysis/status", response_model=AnalysisStatusResponse)
def analysis_status(
    interview_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    interview_service.get_interview(db, ctx, interview_id)
    job = job_service.latest(db, ctx.org_id, "analysis", "interview", interview_id)
    if job is None:
        return AnalysisStatusResponse(status="none")
    return AnalysisStatusResponse(
        status=job.status,
        job_id=job.id,
        error=job.error if job.status == "failed" else None,
        analysis_id=(job.result or {}).get("analysis_id"),
    )


@router.get("/{interview_id}/analysis", response_model=AnalysisResponse)
def get_analysis(
    interview_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    interview_service.get_interview(db, ctx, interview_id)
    a = (
        db.query(Analysis)
        .filter(Analysis.interview_id == interview_id, Analysis.org_id == ctx.org_id)
        .order_by(Analysis.id.desc())
        .first()
    )
    if a is None:
        raise NotFound("No analysis yet", "no_analysis")
    return a


# ── notetaker bot ─────────────────────────────────────────────────────────────
@router.post("/{interview_id}/bot", status_code=202, response_model=BotSessionOut)
def send_bot(
    interview_id: int,
    body: BotRequest | None = None,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return bot_service.request_bot(db, ctx, interview_id, (body or BotRequest()).mode)


@router.delete("/{interview_id}/bot", response_model=BotSessionOut)
def stop_bot(
    interview_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return bot_service.stop_bot(db, ctx, interview_id)


# ── audio/video upload: browser -> S3 (presigned PUT) -> transcriber ──────────
@router.post("/{interview_id}/recording-upload", response_model=RecordingUploadResponse)
def start_recording_upload(
    interview_id: int,
    body: RecordingUploadRequest,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    interview_service.get_interview(db, ctx, interview_id)
    return recording_service.start_recording_upload(ctx.org_id, interview_id, body.content_type)


@router.post("/{interview_id}/recording-upload/complete", status_code=202)
def complete_recording_upload(
    interview_id: int,
    body: RecordingUploadComplete,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    interview_service.get_interview(db, ctx, interview_id)
    rec = recording_service.complete_recording_upload(db, ctx.org_id, interview_id, body.key)
    audit_service.record(db, ctx, "recording.uploaded", "interview", interview_id, recording_id=rec.id)
    db.commit()
    from app.worker.tasks.bots import transcribe_upload_task

    transcribe_upload_task.delay(ctx.org_id, interview_id, rec.blob_path)
    return {"status": "queued", "recording_id": rec.id}
