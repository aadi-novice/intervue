"""Legacy candidate-level analysis endpoints (resolve to the candidate's newest interview)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context, require_role
from app.api.limits import limit_org
from app.db.dependencies import get_db
from app.schemas.analysis import AnalysisStatusResponse
from app.services import analysis_service, candidate_service, job_service

router = APIRouter(prefix="/analysis", tags=["Analysis"])


@router.post(
    "/candidates/{candidate_id}",
    status_code=202,
    response_model=AnalysisStatusResponse,
)
def analyze_candidate_route(
    candidate_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
    _rate: None = Depends(limit_org("analysis", "limit_analysis_per_hour")),
):
    iv = analysis_service.latest_interview_for_candidate(db, ctx, candidate_id)
    job = analysis_service.request_interview_analysis(db, ctx, iv.id)
    return AnalysisStatusResponse(status="queued", job_id=job.id)


@router.get("/candidates/{candidate_id}/status", response_model=AnalysisStatusResponse)
def analysis_status(
    candidate_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    candidate_service.get_candidate(db, ctx, candidate_id)  # 404 / visibility check
    job = job_service.latest_for_candidate_interviews(db, ctx.org_id, candidate_id)
    if job is None:
        return AnalysisStatusResponse(status="none")
    return AnalysisStatusResponse(
        status=job.status,
        job_id=job.id,
        error=job.error if job.status == "failed" else None,
        analysis_id=(job.result or {}).get("analysis_id"),
    )
