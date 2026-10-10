from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context, require_role
from app.db.dependencies import get_db
from app.schemas.dashboard import ActivityItem, DashboardSummary, UsageOut
from app.services import dashboard_service

router = APIRouter(tags=["Dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return dashboard_service.summary(db, ctx)


@router.get("/orgs/{org_id}/usage", response_model=UsageOut)
def org_usage(
    org_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    """AI spend this month by purpose (admin only)."""
    return dashboard_service.usage(db, ctx)


@router.get("/candidates/{candidate_id}/activity", response_model=list[ActivityItem])
def candidate_activity(
    candidate_id: int,
    ctx: OrgContext = Depends(require_role("recruiter", "hiring_manager")),
    db: Session = Depends(get_db),
):
    return dashboard_service.activity(db, ctx, candidate_id)
