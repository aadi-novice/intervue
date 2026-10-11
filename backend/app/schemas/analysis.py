from datetime import datetime

from typing import Literal

from pydantic import BaseModel, field_validator


class AnalysisResponse(BaseModel):

    id: int

    summary: str

    strengths: list
    weaknesses: list

    technical_score: int
    communication_score: int
    confidence_score: int

    key_moments: list

    resume_alignment: list

    candidate_id: int
    interview_id: int | None = None
    hiring_recommendation: str | None = None

    created_at: datetime

    model_config = {
        "from_attributes": True
    }

    @field_validator("strengths", "weaknesses", "key_moments", "resume_alignment", mode="before")
    @classmethod
    def _none_is_empty(cls, v):
        return [] if v is None else v


class AnalysisStatusResponse(BaseModel):
    status: Literal["none", "queued", "running", "completed", "failed"]
    job_id: int | None = None
    error: str | None = None
    analysis_id: int | None = None
