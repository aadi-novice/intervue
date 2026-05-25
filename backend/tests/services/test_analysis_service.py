"""Tests for the analysis service with mocked AI dependencies."""

from unittest.mock import patch, MagicMock

import pytest

from app.models.analysis import Analysis


@patch("app.services.analysis_service.extract_text_from_pdf")
@patch("app.services.analysis_service.load_transcript")
@patch("app.services.analysis_service.chunk_transcript")
@patch("app.services.analysis_service.generate_candidate_analysis")
@patch("app.services.analysis_service.compare_resume_and_transcript")
def test_analyze_candidate_success(
    mock_compare,
    mock_summarize,
    mock_chunk,
    mock_load,
    mock_extract,
    db_session,
):
    """A complete analysis should save an Analysis record."""
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.services.analysis_service import analyze_candidate

    # Setup test data
    role = Role(name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(
        name="Alice",
        email="alice@example.com",
        role_id=role.id,
        resume_path="https://storage.example.com/resume.pdf",
        transcript_path="https://storage.example.com/transcript.txt",
    )
    db_session.add(candidate)
    db_session.commit()

    # Mock AI responses
    mock_extract.return_value = "Resume text"
    mock_load.return_value = "Transcript text"
    mock_chunk.return_value = [
        {"timestamp": "0:00", "speaker": "Interviewer", "text": "Hello"}
    ]
    mock_summarize.return_value = {
        "summary": "Strong candidate with good technical skills.",
        "strengths": ["Strong problem-solving", "Clear communication"],
        "weaknesses": ["Could improve system design"],
        "technical_score": 85,
        "communication_score": 80,
        "confidence_score": 75,
        "key_moments": [{"time": "10:30", "event": "Solved algorithm problem"}],
    }
    mock_compare.return_value = {
        "comparisons": [
            {"claim": "Python expert", "result": "Confirmed", "severity": "low"}
        ]
    }

    # Run service
    analysis = analyze_candidate(candidate.id, db_session)

    assert isinstance(analysis, Analysis)
    assert analysis.summary == "Strong candidate with good technical skills."
    assert analysis.technical_score == 85
    assert analysis.communication_score == 80
    assert analysis.confidence_score == 75
    assert len(analysis.strengths) == 2
    assert analysis.candidate_id == candidate.id
    assert len(analysis.resume_alignment) == 1


@patch("app.services.analysis_service.extract_text_from_pdf")
@patch("app.services.analysis_service.load_transcript")
@patch("app.services.analysis_service.chunk_transcript")
@patch("app.services.analysis_service.generate_candidate_analysis")
@patch("app.services.analysis_service.compare_resume_and_transcript")
def test_analyze_candidate_calls_all_ai_services(
    mock_compare,
    mock_summarize,
    mock_chunk,
    mock_load,
    mock_extract,
    db_session,
):
    """The analysis service should call all AI sub-services."""
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.services.analysis_service import analyze_candidate

    role = Role(name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(
        name="Bob",
        email="bob@example.com",
        role_id=role.id,
        resume_path="https://storage.example.com/resume.pdf",
        transcript_path="https://storage.example.com/transcript.txt",
    )
    db_session.add(candidate)
    db_session.commit()

    # Mock returns
    mock_extract.return_value = "resume text"
    mock_load.return_value = "transcript text"
    mock_chunk.return_value = []
    mock_summarize.return_value = {
        "summary": "S", "strengths": [], "weaknesses": [],
        "technical_score": 1, "communication_score": 1, "confidence_score": 1,
        "key_moments": [],
    }
    mock_compare.return_value = {"comparisons": []}

    analyze_candidate(candidate.id, db_session)

    mock_extract.assert_called_once_with(candidate.resume_path)
    mock_load.assert_called_once_with(candidate.transcript_path)
    mock_chunk.assert_called_once_with("transcript text")
    mock_summarize.assert_called_once()
    mock_compare.assert_called_once()


def test_analyze_candidate_not_found(db_session):
    """Should raise Exception for non-existent candidate."""
    from app.services.analysis_service import analyze_candidate

    with pytest.raises(Exception, match="Candidate not found"):
        analyze_candidate(9999, db_session)


def test_analyze_candidate_no_resume(db_session):
    """Should raise Exception when resume is missing."""
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.services.analysis_service import analyze_candidate

    role = Role(name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(
        name="No Resume",
        email="noresume@example.com",
        role_id=role.id,
        #
        transcript_path="https://storage.example.com/transcript.txt",
    )
    db_session.add(candidate)
    db_session.commit()

    with pytest.raises(Exception, match="Resume not uploaded"):
        analyze_candidate(candidate.id, db_session)


def test_analyze_candidate_no_transcript(db_session):
    """Should raise Exception when transcript is missing."""
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.services.analysis_service import analyze_candidate

    role = Role(name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(
        name="No Transcript",
        email="notranscript@example.com",
        role_id=role.id,
        resume_path="https://storage.example.com/resume.pdf",
    )
    db_session.add(candidate)
    db_session.commit()

    with pytest.raises(Exception, match="Transcript not uploaded"):
        analyze_candidate(candidate.id, db_session)
