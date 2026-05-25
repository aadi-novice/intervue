"""Tests for the analysis Pydantic schemas."""
from app.schemas.analysis import AnalysisResponse


class TestAnalysisResponse:
    def test_from_attributes(self):
        data = AnalysisResponse.model_validate({
            "id": 1,
            "summary": "Good candidate",
            "strengths": ["Communication"],
            "weaknesses": ["System design"],
            "technical_score": 85,
            "communication_score": 80,
            "confidence_score": 75,
            "key_moments": [{"time": "10:30", "event": "Solved problem"}],
            "resume_alignment": [],
            "candidate_id": 1,
            "created_at": "2025-01-01T00:00:00",
        })
        assert data.summary == "Good candidate"
        assert data.technical_score == 85
        assert data.candidate_id == 1
