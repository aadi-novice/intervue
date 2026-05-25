"""Tests for the candidate Pydantic schemas."""
import pytest
from pydantic import ValidationError

from app.schemas.candidate import (
    CandidateCreate,
    CandidateResponse,
    PipelineCandidateResponse,
    CandidateDetailResponse,
    AnalysisSummary,
    ResumeProfileSummary,
    STAGE_COLORS,
)


class TestCandidateCreate:
    def test_valid_input(self):
        data = CandidateCreate(name="Alice", email="alice@example.com", role_id=1)
        assert data.name == "Alice"
        assert data.email == "alice@example.com"
        assert data.role_id == 1
        assert data.phone is None

    def test_with_phone(self):
        data = CandidateCreate(
            name="Bob", email="bob@example.com", role_id=2, phone="+1-555-0100"
        )
        assert data.phone == "+1-555-0100"

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            CandidateCreate(name="Bad", email="not-an-email", role_id=1)

    def test_missing_required_fields(self):
        with pytest.raises(ValidationError):
            CandidateCreate()


class TestCandidateResponse:
    def test_from_attributes(self):
        """CandidateResponse should work with from_attributes (ORM mode)."""
        data = CandidateResponse.model_validate({
            "id": 1,
            "name": "Alice",
            "email": "alice@example.com",
            "phone": None,
            "status": "applied",
            "role_id": 1,
            "resume_path": None,
            "transcript_path": None,
            "created_at": "2025-01-01T00:00:00",
        })
        assert data.name == "Alice"


class TestPipelineCandidateResponse:
    def test_valid_data(self):
        data = PipelineCandidateResponse(
            id="1",
            name="Alice",
            role="Engineer",
            score=85,
            avatar="AL",
            color="#10b981",
            days=3,
            ai=True,
            stage="interview",
            email="alice@example.com",
            role_id=1,
        )
        assert data.score == 85
        assert data.ai is True


class TestAnalysisSummary:
    def test_aggregate_score(self):
        summary = AnalysisSummary(
            id=1,
            summary="Good",
            strengths=["A"],
            weaknesses=["B"],
            key_moments=[],
            resume_alignment=[],
            technical_score=90,
            communication_score=80,
            confidence_score=70,
            aggregate_score=80,
            created_at="2025-01-01T00:00:00",
        )
        assert summary.technical_score == 90
        assert summary.aggregate_score == 80


class TestResumeProfileSummary:
    def test_valid_data(self):
        profile = ResumeProfileSummary(
            basics={"full_name": "Alice"},
            summary="A summary",
            education=[],
            experience=[],
            projects=[],
            skills={"languages": ["Python"]},
            metadata={"pages": 1},
        )
        assert profile.basics["full_name"] == "Alice"
        assert profile.skills["languages"] == ["Python"]


class TestSTAGE_COLORS:
    def test_all_stages_have_colors(self):
        expected = {"applied", "screening", "interview", "offer", "hired"}
        assert set(STAGE_COLORS.keys()) == expected
        for color in STAGE_COLORS.values():
            assert color.startswith("#")
