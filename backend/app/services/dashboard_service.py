"""Dashboard summary, org AI usage, candidate activity, pipeline enrichment."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.models.ai_run import AIRun
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.interview import Interview
from app.models.role import Role
from app.models.rubric import RoleMatch
from app.models.tenancy import AuditLog, User
from app.schemas.dashboard import (
    ActivityItem,
    DashboardRole,
    DashboardSummary,
    RecentAnalysis,
    UsageByPurpose,
    UsageOut,
)
from app.services import card_service, candidate_service, interview_service, job_service


def _month_start() -> datetime:
    n = datetime.now(UTC)
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_cost(db: Session, org_id: int) -> float:
    total = (
        db.query(func.coalesce(func.sum(AIRun.cost_usd), 0))
        .filter(AIRun.org_id == org_id, AIRun.created_at >= _month_start())
        .scalar()
    )
    return float(total or 0)


def usage(db: Session, ctx: OrgContext) -> UsageOut:
    rows = (
        db.query(
            AIRun.purpose,
            func.count(AIRun.id),
            func.coalesce(func.sum(AIRun.cost_usd), 0),
            func.coalesce(func.sum(AIRun.input_tokens), 0),
            func.coalesce(func.sum(AIRun.output_tokens), 0),
        )
        .filter(AIRun.org_id == ctx.org_id, AIRun.created_at >= _month_start(), AIRun.status != "cached")
        .group_by(AIRun.purpose)
        .order_by(func.sum(AIRun.cost_usd).desc())
        .all()
    )
    by = [
        UsageByPurpose(
            purpose=p, runs=n, cost_usd=float(c), input_tokens=int(i), output_tokens=int(o)
        )
        for p, n, c, i, o in rows
    ]
    return UsageOut(month=_month_start().strftime("%Y-%m"), total_usd=round(sum(b.cost_usd for b in by), 5), by_purpose=by)


def summary(db: Session, ctx: OrgContext) -> DashboardSummary:
    roles = db.query(Role).filter(Role.org_id == ctx.org_id, Role.status == "open").order_by(Role.id).all()
    counts = dict(
        db.query(Candidate.role_id, func.count(Candidate.id))
        .filter(Candidate.org_id == ctx.org_id)
        .group_by(Candidate.role_id)
        .all()
    )
    scored = {
        rid: (n, avg)
        for rid, n, avg in db.query(RoleMatch.role_id, func.count(RoleMatch.id), func.avg(RoleMatch.overall_score))
        .filter(RoleMatch.org_id == ctx.org_id, RoleMatch.status == "scored")
        .group_by(RoleMatch.role_id)
        .all()
    }
    out_roles = []
    for r in roles:
        job = job_service.latest(db, ctx.org_id, "rank", "role", r.id)
        n, avg = scored.get(r.id, (0, None))
        out_roles.append(
            DashboardRole(
                id=r.id, name=r.name, candidate_count=counts.get(r.id, 0), scored_count=n,
                avg_score=round(float(avg), 1) if avg is not None else None,
                rank_status=job.status if job else "none",
            )
        )

    now = datetime.now(UTC)
    upcoming = [
        interview_service.summary(db, iv)
        for iv in interview_service._visible(db, ctx)
        .filter(
            Interview.scheduled_start >= now - timedelta(hours=1),
            Interview.scheduled_start <= now + timedelta(days=7),
            Interview.status.in_(("scheduled", "in_progress")),
        )
        .order_by(Interview.scheduled_start)
        .limit(10)
        .all()
    ]

    recent = []
    if ctx.role != "interviewer":
        blind = card_service.blind_enabled(ctx)
        shown = card_service.revealed_ids(db, ctx) if blind else set()
        rows = (
            db.query(Analysis, Candidate, Role)
            .join(Candidate, Candidate.id == Analysis.candidate_id)
            .outerjoin(Role, Role.id == Analysis.role_id)
            .filter(Analysis.org_id == ctx.org_id)
            .order_by(Analysis.id.desc())
            .limit(5)
            .all()
        )
        for a, c, r in rows:
            recent.append(
                RecentAnalysis(
                    analysis_id=a.id, interview_id=a.interview_id,
                    candidate=card_service.mini(c, blind and c.id not in shown),
                    role_name=r.name if r else None,
                    aggregate=round((a.technical_score + a.communication_score + a.confidence_score) / 3),
                    recommendation=a.hiring_recommendation, created_at=a.created_at,
                )
            )
    return DashboardSummary(
        roles=out_roles,
        upcoming_interviews=upcoming,
        recent_analyses=recent,
        ai_cost_month_usd=round(month_cost(db, ctx.org_id), 4) if ctx.role == "admin" else None,
    )


def activity(db: Session, ctx: OrgContext, candidate_id: int) -> list[ActivityItem]:
    candidate_service.get_candidate(db, ctx, candidate_id)  # 404 / visibility
    rows = (
        db.query(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.user_id)
        .filter(
            AuditLog.org_id == ctx.org_id,
            AuditLog.entity_type == "candidate",
            AuditLog.entity_id == str(candidate_id),
        )
        .order_by(AuditLog.id.desc())
        .limit(100)
        .all()
    )
    return [
        ActivityItem(
            id=a.id, action=a.action, user_name=(u.full_name or u.email) if u else None,
            created_at=a.created_at, metadata=a.metadata_ or {},
        )
        for a, u in rows
    ]


def best_matches(db: Session, org_id: int, candidate_ids: list[int]) -> dict[int, dict]:
    """candidate_id -> best open-role match (highest score, else highest similarity)."""
    if not candidate_ids:
        return {}
    rows = (
        db.query(RoleMatch, Role)
        .join(Role, Role.id == RoleMatch.role_id)
        .filter(RoleMatch.org_id == org_id, RoleMatch.candidate_id.in_(candidate_ids), Role.status == "open")
        .all()
    )
    best: dict[int, tuple] = {}
    for m, r in rows:
        key = (m.overall_score is not None, m.overall_score or 0, m.vector_similarity or 0)
        if m.candidate_id not in best or key > best[m.candidate_id][0]:
            best[m.candidate_id] = (key, {
                "role_id": r.id, "role_name": r.name, "score": m.overall_score,
                "similarity": m.vector_similarity,
            })
    return {cid: v[1] for cid, v in best.items()}


def interviewed_ids(db: Session, org_id: int, candidate_ids: list[int]) -> set[int]:
    if not candidate_ids:
        return set()
    return {
        r[0]
        for r in db.query(Interview.candidate_id)
        .filter(Interview.org_id == org_id, Interview.candidate_id.in_(candidate_ids))
        .distinct()
    }
