from datetime import datetime

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