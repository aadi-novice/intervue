"""Notetaker bot lifecycle: request/stop, launch, queueing, event handling, stuck-session reaping."""

import logging
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import security, storage
from app.core.config import settings
from app.core.errors import Conflict, Invalid
from app.models.interview import BotSession, Interview, SpeakerEvent
from app.models.tenancy import Organization
from app.services import audit_service, interview_service
from app.worker.bot_launchers import BotSpec, get_launcher

log = logging.getLogger(__name__)

ACTIVE = ("launching", "joining", "waiting_admission", "in_call", "leaving")
NON_TERMINAL = ("scheduled", *ACTIVE)
SUPPORTED_PLATFORMS = ("google_meet",)  # Teams: M7, Zoom: M8
ORDER = {s: i for i, s in enumerate(
    ("scheduled", "launching", "joining", "waiting_admission", "in_call", "leaving", "completed", "failed")
)}
LEAD_TIME = timedelta(minutes=1)
UPLOAD_CONTENT_TYPES = {"audio/ogg", "application/json", "image/png"}
_BLOB_RE = re.compile(r"^recordings/(\d+)/[A-Za-z0-9._-]{1,100}$")


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def consent_message_for(org: Organization) -> str:
    """Mandatory. Orgs can re-word it (validated >= 10 chars) but never disable it."""
    custom = (org.settings or {}).get("consent_message")
    return custom.strip() if custom and len(custom.strip()) >= 10 else settings.bot_default_consent


def bot_name_for(org: Organization) -> str:
    return ((org.settings or {}).get("bot_name") or settings.bot_name).strip()[:80]


def _active_counts(db: Session, org_id: int) -> tuple[int, int]:
    q = db.query(func.count(BotSession.id)).filter(BotSession.status.in_(ACTIVE))
    return q.filter(BotSession.org_id == org_id).scalar() or 0, q.scalar() or 0


def has_capacity(db: Session, org_id: int) -> bool:
    per_org, total = _active_counts(db, org_id)
    return per_org < settings.bot_concurrency_per_org and total < settings.bot_concurrency_global


# ── API-side ──────────────────────────────────────────────────────────────────
def schedule_bot(db: Session, org: Organization, iv: Interview, mode: str = "now") -> BotSession:
    """Create a bot session for an interview (no request context needed: also used by calendar
    sync). Caller commits audit entries; this commits the session and launches when mode=now."""
    if not iv.meeting_url or iv.platform not in SUPPORTED_PLATFORMS:
        raise Invalid(
            "The notetaker supports Google Meet links for now. Upload a transcript or recording instead.",
            "platform_unsupported",
        )
    if iv.status in ("cancelled", "completed"):
        raise Conflict(f"Interview is {iv.status}", "interview_closed")
    if any(b.status in NON_TERMINAL for b in iv.bot_sessions):
        raise Conflict("A notetaker is already scheduled or in the call", "bot_active")

    start = _aware(iv.scheduled_start)
    if mode == "scheduled" and (start is None or start - LEAD_TIME <= _now()):
        raise Invalid("Scheduled sends need a future scheduled_start", "bad_schedule")

    session = BotSession(
        org_id=iv.org_id, interview_id=iv.id, status="scheduled",
        launch_at=_now() if mode == "now" else start - LEAD_TIME,
        consent_message=consent_message_for(org),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    if mode == "now":
        launch_session(db, session.id)  # queues (stays 'scheduled') if at capacity
        db.refresh(session)
    return session


def request_bot(db: Session, ctx: OrgContext, interview_id: int, mode: str = "now") -> BotSession:
    iv = interview_service.get_interview(db, ctx, interview_id)
    session = schedule_bot(db, ctx.org, iv, mode)
    audit_service.record(db, ctx, "bot.requested", "interview", iv.id, mode=mode)
    db.commit()
    return session


def cancel_scheduled_bot(db: Session, iv: Interview) -> bool:
    """Cancel a not-yet-launched session (calendar event moved/cancelled). Returns True if any."""
    cancelled = False
    for b in iv.bot_sessions:
        if b.status == "scheduled":
            b.status = "failed"
            b.failure_reason = "cancelled"
            cancelled = True
    if cancelled:
        db.commit()
    return cancelled


def reschedule_bot(db: Session, iv: Interview) -> None:
    """Calendar event time changed: move launch_at of a still-scheduled session."""
    start = _aware(iv.scheduled_start)
    for b in iv.bot_sessions:
        if b.status == "scheduled" and start is not None:
            b.launch_at = max(start - LEAD_TIME, _now())
    db.commit()


def stop_bot(db: Session, ctx: OrgContext, interview_id: int) -> BotSession:
    iv = interview_service.get_interview(db, ctx, interview_id)
    session = next((b for b in reversed(iv.bot_sessions) if b.status in NON_TERMINAL), None)
    if session is None:
        raise Conflict("No notetaker is active for this interview", "no_active_bot")
    if session.status == "scheduled":  # never launched: just cancel it
        session.status = "failed"
        session.failure_reason = "cancelled"
    else:
        session.stop_requested = True  # the bot polls /control and leaves gracefully
    audit_service.record(db, ctx, "bot.stopped", "interview", iv.id)
    db.commit()
    db.refresh(session)
    return session


# ── launching (API "now" path and the beat scheduler) ─────────────────────────
def launch_session(db: Session, session_id: int) -> bool:
    """Launch a scheduled session if capacity allows. Returns True when launched."""
    session = db.get(BotSession, session_id)
    if session is None or session.status != "scheduled" or session.stop_requested:
        return False
    if not has_capacity(db, session.org_id):
        return False  # stays queued; the beat task retries
    iv = db.get(Interview, session.interview_id)
    org = db.get(Organization, session.org_id)
    spec = BotSpec(
        session_id=session.id,
        meeting_url=iv.meeting_url,
        bot_name=bot_name_for(org),
        consent_message=session.consent_message or consent_message_for(org),
        callback_url=settings.internal_api_url.rstrip("/"),
        callback_secret=security.derive_bot_secret(session.id),
        upload_prefix=f"recordings/{session.id}/",
        max_duration_min=settings.bot_max_duration_min,
        admission_timeout_min=settings.bot_admission_timeout_min,
        alone_timeout_sec=settings.bot_alone_timeout_sec,
    )
    session.status = "launching"
    db.commit()
    try:
        session.container_ref = get_launcher().launch(spec)
    except Exception as e:
        log.exception("bot launch failed for session %s", session.id)
        session.status = "failed"
        session.failure_reason = "launch_failed"
        session.failure_detail = str(e)[:1000]
        db.commit()
        return False
    db.commit()
    return True


def launch_due(db: Session) -> int:
    """Beat task: launch scheduled sessions whose launch_at has passed (also drains the queue)."""
    launched = 0
    due = (
        db.query(BotSession)
        .filter(
            BotSession.status == "scheduled",
            BotSession.stop_requested.is_(False),
            BotSession.launch_at <= _now(),
        )
        .order_by(BotSession.launch_at, BotSession.id)
        .all()
    )
    for s in due:
        if launch_session(db, s.id):
            launched += 1
    return launched


def reap_stuck(db: Session) -> int:
    cutoff = _now() - timedelta(minutes=settings.bot_stuck_after_minutes)
    n = 0
    for s in db.query(BotSession).filter(BotSession.status.in_(ACTIVE)).all():
        if _aware(s.updated_at) < cutoff:
            if s.container_ref:
                try:
                    get_launcher().stop(s.container_ref)
                except Exception:
                    pass
            s.status = "failed"
            s.failure_reason = "timeout"
            s.failure_detail = "No updates from the bot; marked failed by the reaper"
            n += 1
    if n:
        db.commit()
    return n


# ── internal API (bot -> backend) ─────────────────────────────────────────────
def get_session(db: Session, session_id: int) -> BotSession | None:
    return db.get(BotSession, session_id)


def control_action(session: BotSession) -> str:
    return "stop" if session.stop_requested or session.status in ("completed", "failed") else "none"


def object_key_for(session: BotSession, blob: str) -> str:
    """Bot-relative blob path -> org-prefixed object key; rejects anything outside its prefix."""
    m = _BLOB_RE.match(blob or "")
    if not m or int(m.group(1)) != session.id:
        raise Invalid("Invalid blob path", "bad_blob")
    return f"{session.org_id}/{blob}"


def upload_url(session: BotSession, blob: str, content_type: str) -> dict:
    if content_type not in UPLOAD_CONTENT_TYPES:
        raise Invalid("Unsupported content type", "bad_content_type")
    key = object_key_for(session, blob)
    return {
        "url": storage.presigned_put(key, 900, content_type),
        "headers": {"Content-Type": content_type},
    }


def handle_event(db: Session, session: BotSession, payload: dict) -> None:
    """Apply a bot event. Idempotent; statuses only move forward."""
    iv = db.get(Interview, session.interview_id)
    kind = payload.get("type")

    if kind == "status":
        new = payload.get("status")
        if new not in ORDER:
            raise Invalid("Unknown status", "bad_status")
        if ORDER[new] > ORDER[session.status] and session.status not in ("completed", "failed"):
            session.status = new
        if new == "in_call":
            session.joined_at = session.joined_at or _now()
            if iv.status in ("scheduled",):
                iv.status = "in_progress"
        if new == "leaving":
            session.left_at = session.left_at or _now()

    elif kind == "consent_sent":
        session.consent_message_sent_at = session.consent_message_sent_at or _now()

    elif kind == "speaker_events":
        events = payload.get("events") or []
        if len(events) > 2000:
            raise Invalid("Too many events", "too_many_events")
        db.add_all(
            SpeakerEvent(
                interview_id=iv.id, t_ms=int(e["t_ms"]), speaker_name=str(e["name"])[:200]
            )
            for e in events
            if "t_ms" in e and e.get("name")
        )

    elif kind == "chunk_uploaded":
        key = object_key_for(session, payload.get("blob", ""))
        chunks = list(session.chunks or [])
        if not any(c["index"] == payload["index"] for c in chunks):
            chunks.append(
                {
                    "index": int(payload["index"]),
                    "blob": key,
                    "start_ms": int(payload.get("start_ms", 0)),
                    "duration_ms": int(payload.get("duration_ms", 0)),
                }
            )
            session.chunks = sorted(chunks, key=lambda c: c["index"])
        if session.recording_started_at is None:
            session.recording_started_at = _now()

    elif kind == "completed":
        if session.status != "failed":
            session.status = "completed"
        session.manifest_key = object_key_for(session, payload["manifest_blob"])
        session.left_at = session.left_at or _now()
        iv.status = "processing"
        db.commit()
        _enqueue_pipeline(session)
        return

    elif kind == "failed":
        session.status = "failed"
        session.failure_reason = str(payload.get("reason") or "crash")[:50]
        session.failure_detail = str(payload.get("detail") or "")[:1000]
        shot = payload.get("screenshot_blob")
        if shot:
            try:
                session.screenshot_key = object_key_for(session, shot)
            except Invalid:
                pass
        session.left_at = session.left_at or _now()
        from app.services import notification_service

        notification_service.notify(
            db, session.org_id, iv.created_by_user_id, "bot_failed",
            f"Notetaker could not record: {iv.title}",
            f"Reason: {session.failure_reason}. You can upload a recording or transcript instead.",
            f"/interviews/{iv.id}",
        )
        if session.chunks:  # salvage partial recordings
            iv.status = "processing"
            db.commit()
            _enqueue_pipeline(session)
            return
        iv.status = "failed"

    else:
        raise Invalid("Unknown event type", "bad_event")
    db.commit()


def _enqueue_pipeline(session: BotSession) -> None:
    from app.worker.tasks.bots import process_recording_task

    process_recording_task.delay(session.org_id, session.id)
