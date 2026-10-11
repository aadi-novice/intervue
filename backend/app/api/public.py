"""
Public read-only API authenticated with an API key (M10b).

    Authorization: Bearer ik_<8 hex>_<secret>     (or: X-API-Key: ...)

Only GET endpoints that never write are exposed here. In blind-review orgs candidate names and
emails are always masked (a key cannot "reveal"). Keys are org-scoped and rate limited.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, api_error
from app.core import rate_limit
from app.core.config import settings
from app.core.errors import NotFound
from app.db.dependencies import get_db
from app.models.analysis import Analysis
from app.models.tenancy import Organization, User
from app.schemas.analysis import AnalysisResponse
from app.schemas.candidate import PipelineCandidateResponse
from app.schemas.cards import RankingPage
from app.schemas.interview import InterviewSummary
from app.schemas.role import RoleResponse
from app.services import (
    apikey_service,
    candidate_service,
    card_service,
    interview_service,
    role_service,
)

router = APIRouter(prefix="/public/v1", tags=["Public API"])


def get_api_context(request: Request, db: Session = Depends(get_db)) -> OrgContext:
    auth = request.headers.get("authorization", "")
    presented = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-api-key")
    key = apikey_service.authenticate(db, presented)
    if key is None:
        raise api_error(401, "Invalid or missing API key", "invalid_api_key")
    if not rate_limit.hit(f"apikey:{key.id}", settings.api_rate_limit_per_hour, 3600):
        raise api_error(429, "API rate limit reached", "rate_limited")
    org = db.get(Organization, key.org_id)
    # A transient (never persisted) principal: id -1 matches no real user's reveals or audit rows.
    principal = User(id=-1, email="api-key@intervue.invalid", full_name=key.name)
    return OrgContext(user=principal, org=org, role="hiring_manager")


@router.get("/me")
def me(ctx: OrgContext = Depends(get_api_context)):
    return {"organization": {"id": ctx.org.id, "name": ctx.org.name}, "access": "read-only"}


@router.get("/roles", response_model=list[RoleResponse])
def roles(ctx: OrgContext = Depends(get_api_context), db: Session = Depends(get_db)):
    return role_service.list_roles(db, ctx)


@router.get("/roles/{role_id}/rankings", response_model=RankingPage)
def rankings(
    role_id: int,
    must_haves_met: bool | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: OrgContext = Depends(get_api_context),
    db: Session = Depends(get_db),
):
    return card_service.rankings(
        db, ctx, role_id, must_haves_met=must_haves_met, min_score=min_score, offset=offset, limit=limit
    )


@router.get("/candidates", response_model=list[PipelineCandidateResponse])
def candidates(ctx: OrgContext = Depends(get_api_context), db: Session = Depends(get_db)):
    items = candidate_service.list_pipeline(db, ctx)
    if card_service.blind_enabled(ctx):
        for c in items:
            c.name, c.email, c.phone, c.avatar, c.avatar_url = f"Candidate #{c.id}", "", None, "?", None
    return items


@router.get("/interviews", response_model=list[InterviewSummary])
def interviews(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    role_id: int | None = None,
    candidate_id: int | None = None,
    ctx: OrgContext = Depends(get_api_context),
    db: Session = Depends(get_db),
):
    items = interview_service.list_interviews(db, ctx, from_, to, role_id, candidate_id)
    for i in items:
        i.title = "Interview"  # titles often contain a candidate's name
        if card_service.blind_enabled(ctx):
            i.candidate_name = f"Candidate #{i.candidate_id}"
    return items


@router.get("/interviews/{interview_id}/analysis", response_model=AnalysisResponse)
def analysis(interview_id: int, ctx: OrgContext = Depends(get_api_context), db: Session = Depends(get_db)):
    interview_service.get_interview(db, ctx, interview_id)
    a = (
        db.query(Analysis)
        .filter(Analysis.interview_id == interview_id, Analysis.org_id == ctx.org_id)
        .order_by(Analysis.id.desc()).first()
    )
    if a is None:
        raise NotFound("No analysis yet", "no_analysis")
    return a
