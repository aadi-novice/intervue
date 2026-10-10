"""Rubrics, bulk intake, ranking, summary cards, compare, cross-role matches (M5)."""

from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context, require_role
from app.api.limits import limit_org
from app.core.errors import Invalid
from app.db.dependencies import get_db
from app.schemas.cards import (
    BatchOut,
    CompareMatrix,
    CriterionOut,
    MatchOut,
    RankingPage,
    RankStatus,
    RubricIn,
    RubricOut,
    RubricSuggestStatus,
    SummaryCard,
)
from app.services import (
    card_service,
    intake_service,
    job_service,
    ranking_service,
    role_service,
    rubric_service,
)

router = APIRouter(tags=["Ranking"])


def _rubric_out(db: Session, ctx: OrgContext, role_id: int) -> RubricOut:
    crit = rubric_service.list_criteria(db, ctx.org_id, role_id)
    return RubricOut(
        criteria=[CriterionOut.model_validate(c) for c in crit],
        rubric_hash=rubric_service.rubric_hash(crit),
    )


# ── rubric ────────────────────────────────────────────────────────────────────
@router.get("/roles/{role_id}/rubric", response_model=RubricOut)
def get_rubric(role_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    role_service.get_role(db, ctx, role_id)
    return _rubric_out(db, ctx, role_id)


@router.put("/roles/{role_id}/rubric", response_model=RubricOut)
def put_rubric(
    role_id: int,
    body: RubricIn,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    rubric_service.put_rubric(db, ctx, role_id, [c.model_dump() for c in body.criteria])
    from app.worker.tasks.ranking import embed_role_task

    embed_role_task.delay(ctx.org_id, role_id)  # refresh embedding, then debounced re-rank
    return _rubric_out(db, ctx, role_id)


@router.post("/roles/{role_id}/rubric/suggest", status_code=202, response_model=RubricSuggestStatus)
def suggest_rubric(
    role_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    rubric_service.request_suggestion(db, ctx, role_id)
    return RubricSuggestStatus(status="queued")


@router.get("/roles/{role_id}/rubric/suggest/status", response_model=RubricSuggestStatus)
def suggest_status(role_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    role_service.get_role(db, ctx, role_id)
    job = job_service.latest(db, ctx.org_id, rubric_service.SUGGEST_KIND, "role", role_id)
    if job is None:
        return RubricSuggestStatus(status="none")
    return RubricSuggestStatus(
        status=job.status,
        error=job.error if job.status == "failed" else None,
        criteria=(job.result or {}).get("criteria") if job.status == "completed" else None,
    )


# ── bulk intake ───────────────────────────────────────────────────────────────
@router.post(
    "/roles/{role_id}/resumes/bulk",
    status_code=202,
    dependencies=[Depends(limit_org("bulk", "limit_bulk_per_hour"))],
)
def bulk_resumes(
    role_id: int,
    files: list[UploadFile] = File(...),
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    batch = intake_service.create_batch(db, ctx, role_id, files)
    return {"batch_id": batch.id}


@router.get("/batches/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return intake_service.get_batch(db, ctx, batch_id)


# ── ranking ───────────────────────────────────────────────────────────────────
@router.post(
    "/roles/{role_id}/rank",
    status_code=202,
    response_model=RankStatus,
    dependencies=[Depends(limit_org("rank", "limit_rank_per_hour"))],
)
def rank(
    role_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    role_service.get_role(db, ctx, role_id)
    job = ranking_service.request_rank(db, ctx.org_id, role_id)
    return RankStatus(status="queued", job_id=job.id)


@router.get("/roles/{role_id}/rank/status", response_model=RankStatus)
def rank_status(role_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    role_service.get_role(db, ctx, role_id)
    job = job_service.latest(db, ctx.org_id, ranking_service.RANK_KIND, "role", role_id)
    if job is None:
        return RankStatus(status="none")
    return RankStatus(
        status=job.status, job_id=job.id,
        error=job.error if job.status == "failed" else None, progress=job.result,
    )


@router.get("/roles/{role_id}/rankings", response_model=RankingPage)
def rankings(
    role_id: int,
    must_haves_met: bool | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    max_score: float | None = Query(default=None, ge=0, le=100),
    stage: Literal["applied", "screening", "interview", "offer", "hired"] | None = None,
    interviewed: bool | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return card_service.rankings(
        db, ctx, role_id, must_haves_met, min_score, max_score, stage, interviewed, offset, limit
    )


@router.get("/roles/{role_id}/compare", response_model=CompareMatrix)
def compare(
    role_id: int,
    candidate_ids: str = Query(description="comma separated, 2-4 ids"),
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    try:
        ids = [int(x) for x in candidate_ids.split(",") if x.strip()]
    except ValueError:
        raise Invalid("candidate_ids must be integers", "bad_selection")
    return card_service.compare(db, ctx, role_id, ids)


# ── candidate views ───────────────────────────────────────────────────────────
@router.get("/candidates/{candidate_id}/matches", response_model=list[MatchOut])
def matches(candidate_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return card_service.candidate_matches(db, ctx, candidate_id)


@router.get("/candidates/{candidate_id}/summary-card", response_model=SummaryCard)
def summary_card(
    candidate_id: int,
    role_id: int | None = None,
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return card_service.summary_card(db, ctx, candidate_id, role_id)


@router.post("/candidates/{candidate_id}/reveal", status_code=204)
def reveal(
    candidate_id: int,
    ctx: OrgContext = Depends(require_role("recruiter", "hiring_manager")),
    db: Session = Depends(get_db),
):
    card_service.reveal(db, ctx, candidate_id)
    return Response(status_code=204)
