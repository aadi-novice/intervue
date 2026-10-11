"""Candidate business logic. Every function is org-scoped via OrgContext."""

from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session, selectinload

from app.api.deps import OrgContext
from app.core import storage
from app.core.errors import Conflict, Invalid, NotFound
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.interview import Interview, InterviewParticipant
from app.models.resume_profile import ResumeProfile
from app.models.role import Role
from app.schemas.candidate import (
    STAGE_COLORS,
    AnalysisSummary,
    CandidateCreate,
    CandidateDetailResponse,
    PipelineCandidateResponse,
    ResumeProfileSummary,
)
from app.utils.file_handler import save_file

_ATTR = {"resumes": "resume_path", "avatars": "avatar_path"}


def _query(db: Session, ctx: OrgContext) -> Query:
    q = db.query(Candidate).filter(Candidate.org_id == ctx.org_id)
    if ctx.role == "interviewer":
        # interviewers only see candidates they are a participant for
        mine = (
            select(Interview.candidate_id)
            .join(InterviewParticipant, InterviewParticipant.interview_id == Interview.id)
            .where(Interview.org_id == ctx.org_id, InterviewParticipant.user_id == ctx.user.id)
        )
        q = q.filter(Candidate.id.in_(mine))
    return q


def get_candidate(db: Session, ctx: OrgContext, candidate_id: int) -> Candidate:
    c = _query(db, ctx).filter(Candidate.id == candidate_id).first()
    if c is None:
        raise NotFound("Candidate not found")
    return c


def create_candidate(db: Session, ctx: OrgContext, data: CandidateCreate) -> Candidate:
    role = db.query(Role).filter(Role.id == data.role_id, Role.org_id == ctx.org_id).first()
    if role is None:
        raise NotFound("Role not found")
    cand = Candidate(
        org_id=ctx.org_id,
        name=data.name,
        email=str(data.email).lower(),
        phone=data.phone,
        role_id=data.role_id,
        source="manual",
    )
    db.add(cand)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("A candidate with this email already exists", "candidate_exists")
    db.refresh(cand)
    return cand


def _latest(analyses: list[Analysis]) -> Analysis | None:
    return max(analyses, key=lambda a: (a.created_at, a.id)) if analyses else None


def _score(a: Analysis | None) -> int:
    if a is None:
        return 0
    return round((a.technical_score + a.communication_score + a.confidence_score) / 3)


def _identity(c: Candidate) -> dict:
    stage = c.status if c.status in STAGE_COLORS else "applied"
    created = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=UTC)
    return {
        "stage": stage,
        "color": STAGE_COLORS[stage],
        "avatar": "".join(p[0].upper() for p in c.name.split()[:2]),
        "days": (datetime.now(UTC) - created).days,
    }


def _url(key: str | None) -> str | None:
    return storage.presigned_get(key) if key else None


def list_pipeline(db: Session, ctx: OrgContext) -> list[PipelineCandidateResponse]:
    cands = (
        _query(db, ctx)
        .options(selectinload(Candidate.analyses), selectinload(Candidate.role))
        .order_by(Candidate.id)
        .all()
    )
    from app.services import dashboard_service

    ids = [c.id for c in cands]
    best = dashboard_service.best_matches(db, ctx.org_id, ids)
    interviewed = dashboard_service.interviewed_ids(db, ctx.org_id, ids)
    out = []
    for c in cands:
        latest = _latest(c.analyses)
        out.append(
            PipelineCandidateResponse(
                id=str(c.id),
                name=c.name,
                email=c.email,
                phone=c.phone,
                role=c.role.name if c.role else "Unknown Role",
                role_id=c.role_id,
                score=_score(latest),
                ai=latest is not None,
                resume_path=c.resume_path,
                transcript_path=c.transcript_path,
                avatar_path=c.avatar_path,
                avatar_url=_url(c.avatar_path),
                source=c.source,
                interviewed=c.id in interviewed,
                best_match=best.get(c.id),
                **_identity(c),
            )
        )
    return out


def list_by_role(db: Session, ctx: OrgContext, role_id: int) -> list[Candidate]:
    return _query(db, ctx).filter(Candidate.role_id == role_id).all()


def update_status(db: Session, ctx: OrgContext, candidate_id: int, status: str) -> Candidate:
    c = get_candidate(db, ctx, candidate_id)
    c.status = status
    db.commit()
    db.refresh(c)
    return c


def erase_candidate(
    db: Session, ctx: OrgContext, candidate_id: int, action: str = "candidate.erased"
) -> dict:
    """Permanently remove a candidate and everything derived from them (GDPR-style erasure).

    Deletes DB rows explicitly (not relying on database cascades), scrubs cached AI results that
    contain their text, removes related notifications and calendar copies, then deletes every
    stored file. Returns a receipt with counts only (no personal data).
    """
    from app.models.ai_run import AIRun
    from app.models.calendar import CalendarEvent
    from app.models.interview import BotSession, Recording, SpeakerEvent, TranscriptSegment
    from app.models.notification import Notification
    from app.models.rubric import CandidateReveal, RoleMatch
    from app.services import audit_service

    c = get_candidate(db, ctx, candidate_id)
    iv_ids = [i for (i,) in db.query(Interview.id).filter(Interview.candidate_id == c.id)]

    keys = [k for k in (c.resume_path, c.transcript_path, c.avatar_path) if k]
    receipt = {"interviews": len(iv_ids), "recordings": 0, "analyses": len(c.analyses)}
    if iv_ids:
        recs = db.query(Recording).filter(Recording.interview_id.in_(iv_ids)).all()
        receipt["recordings"] = len(recs)
        keys += [r.blob_path for r in recs]
        for s in db.query(BotSession).filter(BotSession.interview_id.in_(iv_ids)):
            keys += [ch.get("blob") for ch in (s.chunks or [])]
            keys += [s.screenshot_key, s.manifest_key]
        db.query(Recording).filter(Recording.interview_id.in_(iv_ids)).delete(synchronize_session=False)
        db.query(SpeakerEvent).filter(SpeakerEvent.interview_id.in_(iv_ids)).delete(synchronize_session=False)
        db.query(TranscriptSegment).filter(TranscriptSegment.interview_id.in_(iv_ids)).delete(synchronize_session=False)
        for iid in iv_ids:
            db.query(Notification).filter(
                Notification.org_id == ctx.org_id, Notification.link.like(f"/interviews/{iid}%")
            ).delete(synchronize_session=False)
        db.query(CalendarEvent).filter(CalendarEvent.interview_id.in_(iv_ids)).delete(synchronize_session=False)
    db.query(CalendarEvent).filter(CalendarEvent.candidate_id == c.id).delete(synchronize_session=False)
    db.query(RoleMatch).filter(RoleMatch.candidate_id == c.id).delete(synchronize_session=False)
    db.query(CandidateReveal).filter(CandidateReveal.candidate_id == c.id).delete(synchronize_session=False)
    # cached model outputs contain the candidate's resume/transcript text: scrub, keep cost rows
    db.query(AIRun).filter(AIRun.org_id == ctx.org_id, AIRun.candidate_id == c.id).update(
        {"result": None, "candidate_id": None}, synchronize_session=False
    )
    db.delete(c)  # ORM cascades: analyses, resume profile, interviews (+participants, notes, bot sessions)
    audit_service.record(db, ctx, action, "candidate", candidate_id, **receipt)
    db.commit()
    deleted = 0
    for k in {k for k in keys if k}:
        try:
            storage.delete(k)
            deleted += 1
        except Exception:
            pass
    return {"candidate_id": candidate_id, "erased_at": datetime.now(UTC).isoformat(),
            "files_deleted": deleted, **receipt}


def delete_candidate(db: Session, ctx: OrgContext, candidate_id: int) -> None:
    erase_candidate(db, ctx, candidate_id, action="candidate.deleted")


def _parse_status(db: Session, org_id: int, c: Candidate, p: ResumeProfile | None) -> tuple[str, str | None]:
    """(status, error): no_resume | pending | ready | failed."""
    if p:
        return "ready", None
    if not c.resume_path:
        return "no_resume", None
    from app.services import job_service

    job = job_service.latest(db, org_id, "resume_parse", "candidate", c.id)
    if job is not None and job.status == "failed":
        return "failed", job.error
    return "pending", None


def detail(db: Session, ctx: OrgContext, candidate_id: int) -> CandidateDetailResponse:
    c = get_candidate(db, ctx, candidate_id)
    latest = _latest(c.analyses)
    analysis_out = None
    if latest:
        analysis_out = AnalysisSummary(
            id=latest.id,
            summary=latest.summary,
            strengths=latest.strengths,
            weaknesses=latest.weaknesses,
            key_moments=latest.key_moments or [],
            resume_alignment=latest.resume_alignment or [],
            technical_score=latest.technical_score,
            communication_score=latest.communication_score,
            confidence_score=latest.confidence_score,
            aggregate_score=_score(latest),
            interview_id=latest.interview_id,
            hiring_recommendation=latest.hiring_recommendation,
            created_at=latest.created_at,
        )
    profile = None
    p = c.resume_profile
    if p:
        profile = ResumeProfileSummary(
            basics=p.basics,
            summary=p.summary,
            education=p.education,
            experience=p.experience,
            projects=p.projects,
            skills=p.skills,
            metadata=p.metadata_,
        )
    parse_status, parse_error = _parse_status(db, ctx.org_id, c, p)
    return CandidateDetailResponse(
        id=str(c.id),
        name=c.name,
        email=c.email,
        phone=c.phone,
        ai=latest is not None,
        role_id=c.role_id,
        role=c.role.name if c.role else "Unknown Role",
        resume_path=c.resume_path,
        transcript_path=c.transcript_path,
        avatar_path=c.avatar_path,
        avatar_url=_url(c.avatar_path),
        resume_url=_url(c.resume_path),
        resume_profile=profile,
        resume_parse_status=parse_status,
        resume_parse_error=parse_error,
        analysis=analysis_out,
        **_identity(c),
    )


def upload(db: Session, ctx: OrgContext, candidate_id: int, file: UploadFile, kind: str) -> str:
    """kind: resumes | avatars. Replaces (and deletes) any previous object."""
    c = get_candidate(db, ctx, candidate_id)
    attr = _ATTR[kind]
    key = save_file(file, kind, ctx.org_id)
    old = getattr(c, attr)
    setattr(c, attr, key)
    if kind == "resumes" and c.resume_profile:
        db.delete(c.resume_profile)  # force re-parse of the new resume
    db.commit()
    if old:
        try:
            storage.delete(old)
        except Exception:
            pass
    return key


def enqueue_resume_parse(db: Session, org_id: int, candidate_id: int) -> None:
    from app.services import job_service
    from app.worker.tasks.resume import parse_resume

    try:
        job = job_service.create(db, org_id, "resume_parse", "candidate", candidate_id)
    except Conflict:
        return  # already queued/running: it will pick up the newest file
    parse_resume.delay(org_id, candidate_id, job.id)


def upload_transcript_as_interview(
    db: Session, ctx: OrgContext, candidate_id: int, file: UploadFile
) -> tuple[int, int]:
    """Legacy candidate-level transcript upload: becomes an interview(platform=upload)."""
    from app.models.interview import Interview, InterviewParticipant
    from app.services import interview_service

    c = get_candidate(db, ctx, candidate_id)
    name = file.filename or "transcript.txt"
    if not name.lower().endswith(interview_service.TRANSCRIPT_EXTS):
        raise Invalid(
            "Unsupported file type. Upload a transcript (.txt, .vtt, .srt, .docx).",
            "unsupported_file",
        )
    file.file.seek(0)
    data = file.file.read(interview_service.MAX_TRANSCRIPT_BYTES + 1)
    iv = Interview(
        org_id=ctx.org_id,
        candidate_id=c.id,
        role_id=c.role_id,
        title="Uploaded transcript",
        platform="upload",
        status="scheduled",
        created_by_user_id=ctx.user.id,
    )
    db.add(iv)
    db.flush()
    db.add(
        InterviewParticipant(
            interview_id=iv.id, display_name=c.name, email=c.email, kind="candidate"
        )
    )
    db.flush()
    db.refresh(iv)
    try:
        count = interview_service.attach_transcript(
            db, ctx, iv, name, data, file.content_type or ""
        )
    except Exception:
        db.rollback()
        raise
    return iv.id, count
