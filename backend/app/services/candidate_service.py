"""Candidate business logic. Every function is org-scoped via OrgContext."""

from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session, selectinload

from app.api.deps import OrgContext
from app.core import storage
from app.core.errors import Conflict, NotFound
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

_ATTR = {"resumes": "resume_path", "transcripts": "transcript_path", "avatars": "avatar_path"}


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


def delete_candidate(db: Session, ctx: OrgContext, candidate_id: int) -> None:
    c = get_candidate(db, ctx, candidate_id)
    keys = [k for k in (c.resume_path, c.transcript_path, c.avatar_path) if k]
    db.delete(c)
    db.commit()
    for k in keys:  # deletion removes blobs too
        try:
            storage.delete(k)
        except Exception:
            pass


def _parse_status(c: Candidate, p: ResumeProfile | None) -> str:
    if p:
        return "ready"
    return "pending" if c.resume_path else "no_resume"


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
        resume_parse_status=_parse_status(c, p),
        analysis=analysis_out,
        **_identity(c),
    )


def upload(db: Session, ctx: OrgContext, candidate_id: int, file: UploadFile, kind: str) -> str:
    """kind: resumes | transcripts | avatars. Replaces (and deletes) any previous object."""
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


def enqueue_resume_parse(org_id: int, candidate_id: int) -> None:
    from app.worker.tasks.resume import parse_resume

    parse_resume.delay(org_id, candidate_id)
