"""Tests for the Analysis SQLAlchemy model."""
from datetime import datetime

from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.role import Role


def _create_candidate(db_session) -> Candidate:
    role = Role(name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()
    candidate = Candidate(name="Test User", email="test@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()
    return candidate


def test_create_analysis(db_session):
    """An analysis can be created with all required fields."""
    candidate = _create_candidate(db_session)

    analysis = Analysis(
        summary="Strong candidate with good skills.",
        strengths=["Great communication", "Strong coding"],
        weaknesses=["Needs improvement in system design"],
        key_moments=[{"time": "10:30", "event": "Solved algorithm problem"}],
        technical_score=85,
        communication_score=80,
        confidence_score=75,
        resume_alignment=[{"claim": "Python expert", "result": "Confirmed"}],
        candidate_id=candidate.id,
    )
    db_session.add(analysis)
    db_session.commit()

    assert analysis.id is not None
    assert analysis.technical_score == 85
    assert analysis.communication_score == 80
    assert analysis.confidence_score == 75
    assert isinstance(analysis.created_at, datetime)
    assert analysis.candidate_id == candidate.id


def test_analysis_candidate_relationship(db_session):
    """An analysis belongs to a candidate, and a candidate has analyses."""
    candidate = _create_candidate(db_session)

    analysis = Analysis(
        summary="Good.",
        strengths=["A"],
        weaknesses=["B"],
        technical_score=70,
        communication_score=70,
        confidence_score=70,
        candidate_id=candidate.id,
    )
    db_session.add(analysis)
    db_session.commit()

    assert analysis.candidate.name == "Test User"
    assert candidate.analyses[0].summary == "Good."


def test_analysis_cascade_delete(db_session):
    """Deleting a candidate deletes its analyses."""
    candidate = _create_candidate(db_session)

    analysis = Analysis(
        summary="Test.",
        strengths=["X"],
        weaknesses=["Y"],
        technical_score=50,
        communication_score=50,
        confidence_score=50,
        candidate_id=candidate.id,
    )
    db_session.add(analysis)
    db_session.commit()
    analysis_id = analysis.id

    db_session.delete(candidate)
    db_session.commit()

    assert db_session.get(Analysis, analysis_id) is None
