from datetime import datetime

from pydantic import BaseModel

from app.schemas.cards import CandidateMini
from app.schemas.interview import InterviewSummary


class DashboardRole(BaseModel):
    id: int
    name: str
    candidate_count: int
    scored_count: int
    avg_score: float | None = None
    rank_status: str


class RecentAnalysis(BaseModel):
    analysis_id: int
    interview_id: int | None = None
    candidate: CandidateMini
    role_name: str | None = None
    aggregate: int
    recommendation: str | None = None
    created_at: datetime


class DashboardSummary(BaseModel):
    roles: list[DashboardRole]
    upcoming_interviews: list[InterviewSummary]
    recent_analyses: list[RecentAnalysis]
    ai_cost_month_usd: float | None = None  # admins only


class UsageByPurpose(BaseModel):
    purpose: str
    runs: int
    cost_usd: float
    input_tokens: int
    output_tokens: int


class UsageOut(BaseModel):
    month: str
    total_usd: float
    by_purpose: list[UsageByPurpose]


class ActivityItem(BaseModel):
    id: int
    action: str
    user_name: str | None = None
    created_at: datetime
    metadata: dict = {}
