from datetime import datetime

from typing import Literal

from pydantic import BaseModel


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

    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class AnalysisStatusResponse(BaseModel):
    status: Literal["none", "queued", "running", "completed", "failed"]
    job_id: int | None = None
    error: str | None = None
    analysis_id: int | None = None
