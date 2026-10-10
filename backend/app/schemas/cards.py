from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Verdict = Literal["verified", "unclear", "contradicted"]


class CandidateMini(BaseModel):
    id: int
    name: str
    email: str | None = None
    avatar_url: str | None = None
    avatar: str
    stage: str
    blind: bool = False  # identity hidden until the user reveals it
    role_id: int


class CriterionResult(BaseModel):
    criterion_id: int
    name: str
    weight: float
    must_have: bool
    score: int  # 0-5
    evidence: list[str]  # verbatim resume quotes
    reasoning: str


class ResumeFit(BaseModel):
    status: str  # pending | shortlisted | scored | failed
    overall_score: float | None = None  # 0-100
    vector_similarity: float | None = None
    must_have_failed: bool = False
    explanation: str | None = None
    criteria: list[CriterionResult] = []
    stale: bool = False


class InterviewFit(BaseModel):
    count: int
    technical_score: int
    communication_score: int
    confidence_score: int
    aggregate: int
    latest_analysis_id: int
    recommendation: str | None = None


class ClaimFlag(BaseModel):
    claim: str
    verdict: Verdict
    severity: str
    segment_ids: list[int] = []
    interview_id: int | None = None


class ClaimChecks(BaseModel):
    verified: int = 0
    unclear: int = 0
    contradicted: int = 0
    flags: list[ClaimFlag] = []


class Suggestion(BaseModel):
    label: Literal["Strong yes", "Yes", "Lean no", "No"] | None
    basis: Literal["interview", "resume", "none"]
    caption: str


class SummaryCard(BaseModel):
    candidate: CandidateMini
    role_id: int
    resume_fit: ResumeFit | None = None
    interview: InterviewFit | None = None
    claim_checks: ClaimChecks
    notes_excerpt: str | None = None
    suggestion: Suggestion


class RankingPage(BaseModel):
    items: list[SummaryCard]
    total: int
    offset: int
    limit: int
    scored_count: int
    rank_status: Literal["none", "queued", "running", "completed", "failed"]
    rank_error: str | None = None
    rank_progress: dict | None = None
    cost_usd: float | None = None


class MatchOut(BaseModel):
    role_id: int
    role_name: str
    is_primary: bool
    status: str
    overall_score: float | None = None
    vector_similarity: float | None = None
    must_have_failed: bool = False
    strong: bool = False


class CompareRowCell(BaseModel):
    candidate_id: int
    value: float | int | None = None
    evidence: list[str] = []


class CompareRow(BaseModel):
    key: str
    label: str
    kind: Literal["resume", "criterion", "interview", "claims"]
    cells: list[CompareRowCell]
    best_candidate_ids: list[int] = []


class CompareMatrix(BaseModel):
    role_id: int
    candidates: list[CandidateMini]
    rows: list[CompareRow]
    suggestions: dict[int, Suggestion]


# ── rubric / intake ───────────────────────────────────────────────────────────
class CriterionIn(BaseModel):
    id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    weight: float = Field(ge=0, le=100)  # relative; normalised to sum to 1 on save
    must_have: bool = False


class RubricIn(BaseModel):
    criteria: list[CriterionIn]


class CriterionOut(BaseModel):
    id: int
    name: str
    description: str
    weight: float
    must_have: bool
    position: int

    model_config = {"from_attributes": True}


class RubricOut(BaseModel):
    criteria: list[CriterionOut]
    rubric_hash: str


class RubricSuggestStatus(BaseModel):
    status: Literal["none", "queued", "running", "completed", "failed"]
    error: str | None = None
    criteria: list[dict] | None = None


class RankStatus(BaseModel):
    status: Literal["none", "queued", "running", "completed", "failed"]
    job_id: int | None = None
    error: str | None = None
    progress: dict | None = None


class BatchOut(BaseModel):
    id: int
    role_id: int
    total: int
    processed: int
    failed: int
    status: str
    errors: list[dict] = []
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
