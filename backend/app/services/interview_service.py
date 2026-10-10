"""Interviews: creation, visibility, detail, transcript upload."""

from datetime import datetime
from urllib.parse import urlparse

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Query, Session, selectinload

from app.ai.transcript_formats import TranscriptParseError, parse_transcript
from app.api.deps import OrgContext
from app.core import storage
from app.core.errors import Conflict, Invalid, NotFound
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.interview import (
    Interview,
    InterviewParticipant,
    Recording,
    TranscriptSegment,
)
from app.models.role import Role
from app.schemas.interview import (
    BotSessionOut,
    InterviewCreate,
    InterviewDetail,
    InterviewSummary,
    NotesOut,
    ParticipantOut,
)
from app.services import audit_service, job_service, transcript_service

TRANSCRIPT_EXTS = (".txt", ".vtt", ".srt", ".docx")
MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024
ACTIVE_BOT = ("scheduled", "launching", "joining", "waiting_admission", "in_call", "leaving")


def detect_platform(url: str | None) -> str:
    if not url:
        return "upload"
    host = (urlparse(url).hostname or "").lower()
    if host.endswith("meet.google.com"):
        return "google_meet"
    if host.endswith("teams.microsoft.com") or host.endswith("teams.live.com"):
        return "teams"
    if host.endswith("zoom.us") or host.endswith("zoom.com"):
        return "zoom"
    if "jitsi" in host or host.endswith("8x8.vc"):
        return "jitsi"
    raise Invalid("Unsupported meeting link. Use a Google Meet, Teams or Zoom URL.", "bad_meeting_url")


def _visible(db: Session, ctx: OrgContext) -> Query:
    q = db.query(Interview).filter(Interview.org_id == ctx.org_id)
    if ctx.role == "interviewer":
        mine = select(InterviewParticipant.interview_id).where(
            InterviewParticipant.user_id == ctx.user.id
        )
        q = q.filter(Interview.id.in_(mine))
    return q


def get_interview(db: Session, ctx: OrgContext, interview_id: int) -> Interview:
    iv = _visible(db, ctx).filter(Interview.id == interview_id).first()
    if iv is None:
        raise NotFound("Interview not found")
    return iv


def create_interview(db: Session, ctx: OrgContext, data: InterviewCreate) -> Interview:
    cand = (
        db.query(Candidate)
        .filter(Candidate.id == data.candidate_id, Candidate.org_id == ctx.org_id)
        .first()
    )
    if cand is None:
        raise NotFound("Candidate not found")
    role_id = data.role_id or cand.role_id
    if db.query(Role).filter(Role.id == role_id, Role.org_id == ctx.org_id).first() is None:
        raise NotFound("Role not found")
    if data.scheduled_start and data.scheduled_end and data.scheduled_end <= data.scheduled_start:
        raise Invalid("scheduled_end must be after scheduled_start", "bad_schedule")

    platform = data.platform or detect_platform(data.meeting_url)
    if platform != "upload" and not data.meeting_url:
        raise Invalid("meeting_url is required for this platform", "meeting_url_required")

    iv = Interview(
        org_id=ctx.org_id,
        candidate_id=cand.id,
        role_id=role_id,
        title=data.title,
        scheduled_start=data.scheduled_start,
        scheduled_end=data.scheduled_end,
        meeting_url=data.meeting_url,
        platform=platform,
        status="scheduled",
        created_by_user_id=ctx.user.id,
    )
    db.add(iv)
    db.flush()

    people = [InterviewParticipant(interview_id=iv.id, display_name=cand.name, email=cand.email, kind="candidate")]
    seen_users = set()
    for p in data.participants:
        if p.user_id is not None:
            seen_users.add(p.user_id)
        people.append(
            InterviewParticipant(
                interview_id=iv.id, user_id=p.user_id, display_name=p.display_name,
                email=p.email, kind=p.kind,
            )
        )
    if ctx.user.id not in seen_users and ctx.role in ("interviewer", "hiring_manager"):
        people.append(
            InterviewParticipant(
                interview_id=iv.id, user_id=ctx.user.id,
                display_name=ctx.user.full_name or ctx.user.email,
                email=ctx.user.email, kind="interviewer",
            )
        )
    db.add_all(people)
    audit_service.record(db, ctx, "interview.created", "interview", iv.id)
    db.commit()
    db.refresh(iv)
    return iv


def list_interviews(
    db: Session,
    ctx: OrgContext,
    start: datetime | None = None,
    end: datetime | None = None,
    role_id: int | None = None,
    candidate_id: int | None = None,
) -> list[InterviewSummary]:
    q = _visible(db, ctx).options(selectinload(Interview.bot_sessions))
    if start:
        q = q.filter(Interview.scheduled_start >= start)
    if end:
        q = q.filter(Interview.scheduled_start <= end)
    if role_id:
        q = q.filter(Interview.role_id == role_id)
    if candidate_id:
        q = q.filter(Interview.candidate_id == candidate_id)
    ivs = q.order_by(Interview.scheduled_start.desc().nullslast(), Interview.id.desc()).all()
    return [summary(db, iv) for iv in ivs]


def _bot_status(iv: Interview) -> str | None:
    return iv.bot_sessions[-1].status if iv.bot_sessions else None


def summary(db: Session, iv: Interview) -> InterviewSummary:
    cand = db.get(Candidate, iv.candidate_id)
    role = db.get(Role, iv.role_id) if iv.role_id else None
    return InterviewSummary(
        id=iv.id, candidate_id=iv.candidate_id, candidate_name=cand.name if cand else "",
        role_id=iv.role_id, role_name=role.name if role else None, title=iv.title,
        scheduled_start=iv.scheduled_start, scheduled_end=iv.scheduled_end,
        meeting_url=iv.meeting_url, platform=iv.platform, status=iv.status,
        bot_status=_bot_status(iv), created_at=iv.created_at,
    )


def detail(db: Session, ctx: OrgContext, iv: Interview) -> InterviewDetail:
    base = summary(db, iv).model_dump()
    seg_count = (
        db.query(func.count(TranscriptSegment.id))
        .filter(TranscriptSegment.interview_id == iv.id)
        .scalar()
    )
    has_rec = db.query(Recording.id).filter(Recording.interview_id == iv.id).first() is not None
    job = job_service.latest(db, ctx.org_id, "analysis", "interview", iv.id)
    return InterviewDetail(
        **base,
        participants=[ParticipantOut.model_validate(p) for p in iv.participants],
        bot_session=BotSessionOut.model_validate(iv.bot_sessions[-1]) if iv.bot_sessions else None,
        notes=NotesOut.model_validate(iv.notes) if iv.notes else None,
        segment_count=seg_count or 0,
        has_recording=has_rec,
        analysis_status=job.status if job else "none",
        analysis_id=(job.result or {}).get("analysis_id") if job else None,
        speakers=transcript_service.speaker_summaries(db, iv.id, ctx.org_id),
    )


def _latest_analysis_id(db: Session, iv: Interview) -> int | None:
    return db.query(func.max(Analysis.id)).filter(Analysis.interview_id == iv.id).scalar()


def attach_transcript(
    db: Session, ctx: OrgContext, iv: Interview, filename: str, data: bytes, content_type: str
) -> int:
    """Parse + store a transcript file for the interview. Returns the segment count."""
    if len(data) > MAX_TRANSCRIPT_BYTES:
        raise Invalid("Transcript too large (5 MB max)", "file_too_large")
    if not data:
        raise Invalid("Empty file", "empty_file")
    try:
        parsed = parse_transcript(filename, data)
    except TranscriptParseError as e:
        raise Invalid(str(e), "unparseable_transcript")
    if filename.lower().endswith(".docx") and not data.startswith(b"PK"):
        raise Invalid("File content does not match a DOCX document", "bad_file")
    key = storage.make_key(ctx.org_id, "transcripts", filename.rsplit(".", 1)[-1] if "." in filename else "txt")
    storage.put(key, data, content_type or "application/octet-stream")
    transcript_service.replace_segments(db, iv, parsed)
    cand = db.get(Candidate, iv.candidate_id)
    old = cand.transcript_path if cand else None
    if cand:
        cand.transcript_path = key  # legacy pointer kept for older clients
    if iv.status in ("scheduled", "failed"):
        iv.status = "completed"
    audit_service.record(db, ctx, "interview.transcript_uploaded", "interview", iv.id, segments=len(parsed))
    db.commit()
    if old:
        try:
            storage.delete(old)
        except Exception:
            pass
    return len(parsed)


def upload_to_interview(db: Session, ctx: OrgContext, interview_id: int, file: UploadFile) -> dict:
    iv = get_interview(db, ctx, interview_id)
    name = (file.filename or "upload").lower()
    if not name.endswith(TRANSCRIPT_EXTS):
        raise Invalid(
            "Unsupported file type. Upload a transcript (.txt, .vtt, .srt, .docx).",
            "unsupported_file",
        )
    file.file.seek(0)
    data = file.file.read(MAX_TRANSCRIPT_BYTES + 1)
    count = attach_transcript(db, ctx, iv, file.filename or "upload.txt", data, file.content_type or "")
    return {"segments": count}


def cancel(db: Session, ctx: OrgContext, interview_id: int) -> Interview:
    iv = get_interview(db, ctx, interview_id)
    if any(b.status in ACTIVE_BOT for b in iv.bot_sessions):
        raise Conflict("Stop the notetaker before cancelling", "bot_active")
    iv.status = "cancelled"
    db.commit()
    return iv
