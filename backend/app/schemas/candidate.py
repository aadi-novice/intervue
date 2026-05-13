from datetime import datetime
from typing import Optional, Literal, Any

from pydantic import BaseModel, EmailStr

StageId = Literal["applied", "screening", "interview", "offer", "hired"]

# ──────────────────────────────────────────
# Stage → accent-color mapping (mirrors frontend STAGES)
# ──────────────────────────────────────────
STAGE_COLORS: dict[str, str] = {
    "applied":   "#8c909f",
    "screening": "#f59e0b",
    "interview": "#3b82f6",
    "offer":     "#10b981",
    "hired":     "#a78bfa",
}


class CandidateCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role_id: int


class CandidateResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str] = None
    status: str

    role_id: int

    resume_path: Optional[str]
    transcript_path: Optional[str]

    created_at: datetime

    model_config = {"from_attributes": True}


class PipelineCandidateResponse(BaseModel):
    """
    Enriched shape consumed by the frontend Kanban pipeline.
    Maps 1-to-1 with the TypeScript Candidate interface in pipeline-store.ts.
    """
    id: str            # frontend uses string ids
    name: str
    role: str          # role name, e.g. "Rust Engineer"
    score: int         # 0-100 aggregate of analysis scores (0 if no analysis yet)
    avatar: str        # 2-letter initials, e.g. "PS"
    color: str         # hex accent derived from stage
    days: int          # days since candidate was created
    ai: bool           # True when at least one Analysis record exists
    stage: str         # maps from Candidate.status

    # extras for detail views
    email: str
    phone: Optional[str] = None
    role_id: int
    resume_path: Optional[str] = None
    transcript_path: Optional[str] = None
    avatar_path: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Sub-models for the detail endpoint ────────────────────────────────────────

class AnalysisSummary(BaseModel):
    """Flattened AI interview analysis block."""
    id: int
    summary: str
    strengths: list[Any]
    weaknesses: list[Any]
    key_moments: list[Any]
    resume_alignment: list[Any]
    technical_score: int
    communication_score: int
    confidence_score: int
    aggregate_score: int          # pre-computed average for convenience
    created_at: datetime

    model_config = {"from_attributes": True}


class ResumeProfileSummary(BaseModel):
    """Parsed resume data extracted once by AI."""
    basics: dict[str, Any]
    summary: str
    education: list[Any]
    experience: list[Any]
    projects: list[Any]
    skills: dict[str, Any]
    metadata: dict[str, Any]


class CandidateDetailResponse(BaseModel):
    """
    Full payload for GET /candidates/{id}.
    Mirrors every section rendered on the frontend detail page.
    """
    # Core identity
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    stage: str
    avatar: str
    color: str
    days: int
    ai: bool

    # Role
    role_id: int
    role: str

    # File paths
    resume_path: Optional[str] = None
    transcript_path: Optional[str] = None
    avatar_path: Optional[str] = None

    # Parsed resume (None if resume not yet uploaded / parsed)
    resume_profile: Optional[ResumeProfileSummary] = None

    # Interview analysis (None if analysis not yet run)
    analysis: Optional[AnalysisSummary] = None