"""Analysis service with mocked AI dependencies."""

from unittest.mock import patch

import pytest

from app.core.errors import Invalid, NotFound
from app.models.analysis import Analysis
from app.services.analysis_service import analyze_candidate
from tests.factories import make_candidate, make_role

P = "app.services.analysis_service"
SUMMARY = {
    "summary": "Strong candidate with good technical skills.",
    "strengths": ["Strong problem-solving", "Clear communication"],
    "weaknesses": ["Could improve system design"],
    "technical_score": 85,
    "communication_score": 80,
    "confidence_score": 75,
    "key_moments": [{"moment": "Solved algorithm", "signal": "positive"}],
    "hiring_recommendation": "Hire",
}
COMPARE = {"comparisons": [{"claim": "Python expert", "result": "Confirmed", "severity": "low"}]}
CHUNKS = [{"timestamp": "10:30", "speaker": "Alice", "text": "I built it in Python"}]


@patch(f"{P}.compare_resume_and_transcript", return_value=COMPARE)
@patch(f"{P}.generate_candidate_analysis", return_value=SUMMARY)
@patch(f"{P}.chunk_transcript", return_value=CHUNKS)
@patch(f"{P}.load_transcript", return_value="raw transcript")
@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_success_persists_analysis_scoped_to_org(
    mock_extract, mock_load, mock_chunk, mock_summarize, mock_compare, db_session, org
):
    role = make_role(db_session, org.id)
    cand = make_candidate(
        db_session, org.id, role.id, resume_path="k/r.pdf", transcript_path="k/t.txt"
    )

    analysis = analyze_candidate(db_session, org.id, cand.id)

    assert isinstance(analysis, Analysis)
    assert analysis.org_id == org.id and analysis.role_id == role.id
    assert analysis.technical_score == 85
    assert analysis.hiring_recommendation == "Hire"
    assert len(analysis.resume_alignment) == 1
    mock_extract.assert_called_once_with("k/r.pdf")
    mock_load.assert_called_once_with("k/t.txt")
    # The LLM gets the formatted transcript (timestamps + speakers) and the org for cost tracking
    assert "[10:30] Alice: I built it in Python" in mock_summarize.call_args.args[1]
    assert mock_summarize.call_args.args[2] == org.id
    assert mock_compare.call_args.args[2] == org.id


def test_not_found(db_session, org):
    with pytest.raises(NotFound):
        analyze_candidate(db_session, org.id, 9999)


def test_other_orgs_candidate_is_not_found(db_session, org, other_org):
    role = make_role(db_session, org.id)
    cand = make_candidate(
        db_session, org.id, role.id, resume_path="k/r.pdf", transcript_path="k/t.txt"
    )
    with pytest.raises(NotFound):
        analyze_candidate(db_session, other_org.id, cand.id)


def test_no_resume(db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, transcript_path="k/t.txt")
    with pytest.raises(Invalid, match="Resume not uploaded"):
        analyze_candidate(db_session, org.id, cand.id)


def test_no_transcript(db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, resume_path="k/r.pdf")
    with pytest.raises(Invalid, match="Transcript not uploaded"):
        analyze_candidate(db_session, org.id, cand.id)


@patch(f"{P}.chunk_transcript", return_value=[])
@patch(f"{P}.load_transcript", return_value="garbage")
@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_unparseable_transcript(m_extract, m_load, m_chunk, db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(
        db_session, org.id, role.id, resume_path="k/r.pdf", transcript_path="k/t.txt"
    )
    with pytest.raises(Invalid, match="parse transcript"):
        analyze_candidate(db_session, org.id, cand.id)
