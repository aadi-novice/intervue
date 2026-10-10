"""Tests for the /analysis API endpoints (async job flow)."""

from unittest.mock import patch

from app.models.job import Job
from tests.factories import make_candidate, make_role

PATCH = "app.services.analysis_service"

SUMMARY = {
    "summary": "Good candidate.",
    "strengths": ["Great communication"],
    "weaknesses": ["Lacks system design"],
    "technical_score": 85,
    "communication_score": 80,
    "confidence_score": 75,
    "key_moments": [{"moment": "Solved BFS", "signal": "positive"}],
    "hiring_recommendation": "Hire",
}
COMPARE = {"comparisons": [{"claim": "Python expert", "result": "Proficient", "severity": "low"}]}
CHUNKS = [{"timestamp": "0:00", "speaker": "Interviewer", "text": "Hello"}]


def _ready_candidate(db, org):
    role = make_role(db, org.id)
    return make_candidate(
        db,
        org.id,
        role.id,
        resume_path=f"{org.id}/resumes/r.pdf",
        transcript_path=f"{org.id}/transcripts/t.txt",
    )


class TestAnalyzeCandidate:
    def test_missing_resume_is_rejected(self, client, db_session, org):
        role = make_role(db_session, org.id)
        cand = make_candidate(db_session, org.id, role.id)

        response = client.post(f"/analysis/candidates/{cand.id}")

        assert response.status_code == 422
        assert response.json()["code"] == "no_resume"

    def test_missing_transcript_is_rejected(self, client, db_session, org):
        role = make_role(db_session, org.id)
        cand = make_candidate(db_session, org.id, role.id, resume_path="1/resumes/r.pdf")

        response = client.post(f"/analysis/candidates/{cand.id}")

        assert response.status_code == 422
        assert response.json()["code"] == "no_transcript"

    def test_candidate_not_found(self, client):
        response = client.post("/analysis/candidates/9999")
        assert response.status_code == 404

    @patch(f"{PATCH}.compare_resume_and_transcript", return_value=COMPARE)
    @patch(f"{PATCH}.generate_candidate_analysis", return_value=SUMMARY)
    @patch(f"{PATCH}.chunk_transcript", return_value=CHUNKS)
    @patch(f"{PATCH}.load_transcript", return_value="transcript")
    @patch(f"{PATCH}.extract_text_from_pdf", return_value="resume")
    def test_success_returns_202_then_status_completed(
        self, m_extract, m_load, m_chunk, m_summarize, m_compare, client, db_session, org
    ):
        cand = _ready_candidate(db_session, org)

        response = client.post(f"/analysis/candidates/{cand.id}")
        assert response.status_code == 202
        assert response.json()["status"] == "queued"

        status = client.get(f"/analysis/candidates/{cand.id}/status").json()
        assert status["status"] == "completed"
        assert status["analysis_id"] is not None

        detail = client.get(f"/candidates/{cand.id}").json()
        assert detail["analysis"]["summary"] == "Good candidate."
        assert detail["analysis"]["technical_score"] == 85

    @patch(f"{PATCH}.chunk_transcript", return_value=CHUNKS)
    @patch(f"{PATCH}.load_transcript", return_value="transcript")
    @patch(f"{PATCH}.extract_text_from_pdf", return_value="resume")
    def test_llm_failure_retries_three_times_then_marks_failed(
        self, m_extract, m_load, m_chunk, client, db_session, org
    ):
        cand = _ready_candidate(db_session, org)
        with patch(
            f"{PATCH}.generate_candidate_analysis", side_effect=RuntimeError("llm down")
        ) as gen:
            response = client.post(f"/analysis/candidates/{cand.id}")
            assert response.status_code == 202
            assert gen.call_count == 4  # first attempt + 3 retries

        status = client.get(f"/analysis/candidates/{cand.id}/status").json()
        assert status["status"] == "failed"
        assert "llm down" in status["error"]

    def test_duplicate_request_while_running_conflicts(self, client, db_session, org):
        cand = _ready_candidate(db_session, org)
        db_session.add(
            Job(
                org_id=org.id,
                kind="analysis",
                entity_type="candidate",
                entity_id=cand.id,
                status="running",
            )
        )
        db_session.commit()

        response = client.post(f"/analysis/candidates/{cand.id}")

        assert response.status_code == 409
        assert response.json()["code"] == "job_in_progress"

    def test_status_none_before_any_run(self, client, db_session, org):
        cand = _ready_candidate(db_session, org)
        assert client.get(f"/analysis/candidates/{cand.id}/status").json()["status"] == "none"

    def test_other_orgs_candidate_is_404(self, other_client, db_session, org):
        cand = _ready_candidate(db_session, org)
        assert other_client.get(f"/analysis/candidates/{cand.id}/status").status_code == 404
        assert other_client.post(f"/analysis/candidates/{cand.id}").status_code == 404
