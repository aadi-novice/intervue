from typing import Literal

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.extractor import extract_text_from_pdf
from app.api.deps import OrgContext, get_org_context, require_role
from app.api.limits import limit_user
from app.core.errors import Invalid
from app.db.dependencies import get_db
from app.schemas.candidate import (
    CandidateCreate,
    CandidateDetailResponse,
    CandidateResponse,
    PipelineCandidateResponse,
)
from app.services import audit_service, candidate_service

router = APIRouter(prefix="/candidates", tags=["candidates"])

Stage = Literal["applied", "screening", "interview", "offer", "hired"]


class StatusUpdate(BaseModel):
    status: Stage


@router.post("/", response_model=CandidateResponse)
def create_candidate(
    body: CandidateCreate,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    cand = candidate_service.create_candidate(db, ctx, body)
    audit_service.record(db, ctx, "candidate.created", "candidate", cand.id)
    db.commit()
    return cand


@router.get("/", response_model=list[PipelineCandidateResponse])
def list_candidates(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return candidate_service.list_pipeline(db, ctx)


@router.get("/role/{role_id}", response_model=list[CandidateResponse])
def get_candidates_by_role(
    role_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    return candidate_service.list_by_role(db, ctx, role_id)


@router.get("/{candidate_id}", response_model=CandidateDetailResponse)
def get_candidate_detail(
    candidate_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    result = candidate_service.detail(db, ctx, candidate_id)
    audit_service.record(db, ctx, "candidate.viewed", "candidate", candidate_id)
    db.commit()
    return result


@router.patch("/{candidate_id}/status", response_model=CandidateResponse)
def update_candidate_status(
    candidate_id: int,
    payload: StatusUpdate,
    ctx: OrgContext = Depends(require_role("recruiter", "hiring_manager")),
    db: Session = Depends(get_db),
):
    return candidate_service.update_status(db, ctx, candidate_id, payload.status)


@router.delete("/{candidate_id}", status_code=204)
def delete_candidate(
    candidate_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    candidate_service.delete_candidate(db, ctx, candidate_id)
    audit_service.record(db, ctx, "candidate.deleted", "candidate", candidate_id)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/{candidate_id}/resume",
    dependencies=[Depends(limit_user("upload", "limit_uploads_per_hour"))],
)
def upload_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    key = candidate_service.upload(db, ctx, candidate_id, file, "resumes")
    candidate_service.enqueue_resume_parse(ctx.org_id, candidate_id)
    return {"message": "Resume uploaded successfully", "file_path": key}


@router.post(
    "/{candidate_id}/transcript",
    dependencies=[Depends(limit_user("upload", "limit_uploads_per_hour"))],
)
def upload_transcript(
    candidate_id: int,
    file: UploadFile = File(...),
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    interview_id, segments = candidate_service.upload_transcript_as_interview(
        db, ctx, candidate_id, file
    )
    return {
        "message": "Transcript uploaded successfully",
        "interview_id": interview_id,
        "segments": segments,
    }


@router.post(
    "/{candidate_id}/avatar",
    dependencies=[Depends(limit_user("upload", "limit_uploads_per_hour"))],
)
def upload_avatar(
    candidate_id: int,
    file: UploadFile = File(...),
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    key = candidate_service.upload(db, ctx, candidate_id, file, "avatars")
    return {"message": "Avatar uploaded successfully", "avatar_path": key}


@router.get("/{candidate_id}/resume-text")
def get_resume_text(
    candidate_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    c = candidate_service.get_candidate(db, ctx, candidate_id)
    if not c.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    return {"resume_text": extract_text_from_pdf(c.resume_path)}
