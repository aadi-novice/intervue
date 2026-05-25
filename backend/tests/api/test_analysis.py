"""Tests for the /analysis API endpoints."""

from unittest.mock import patch


def _create_role_and_candidate(client) -> tuple[int, int]:
    role_resp = client.post("/roles/", json={
        "name": "Engineer",
        "experience_level": "Senior",
        "experience_required_years": 5,
    })
    role_id = role_resp.json()["id"]
    candidate_resp = client.post("/candidates/", json={
        "name": "Alice",
        "email": "alice@example.com",
        "role_id": role_id,
    })
    return role_id, candidate_resp.json()["id"]


class TestAnalyzeCandidate:
    def test_analysis_missing_resume(self, client):
        """Analysis should fail when resume is not uploaded."""
        _, cid = _create_role_and_candidate(client)

        response = client.post(f"/analysis/candidates/{cid}")
        assert response.status_code == 400
        assert "resume" in response.json()["detail"].lower()

    @patch("app.services.analysis_service.compare_resume_and_transcript")
    @patch("app.services.analysis_service.generate_candidate_analysis")
    @patch("app.services.analysis_service.chunk_transcript")
    @patch("app.services.analysis_service.load_transcript")
    @patch("app.services.analysis_service.extract_text_from_pdf")
    def test_analysis_success(
        self,
        mock_extract,
        mock_load,
        mock_chunk,
        mock_summarize,
        mock_compare,
        client,
    ):
        """A full analysis pipeline should succeed when all data is present."""
        _, cid = _create_role_and_candidate(client)

        # Upload resume and transcript
        client.post(f"/candidates/{cid}/resume?file_path=/tmp/test.pdf")
        client.post(f"/candidates/{cid}/transcript?file_path=/tmp/test.txt")

        # Mock AI responses
        mock_extract.return_value = "Resume text content"
        mock_load.return_value = "Transcript text content"
        mock_chunk.return_value = [
            {"timestamp": "0:00", "speaker": "Interviewer", "text": "Hello"}
        ]
        mock_summarize.return_value = {
            "summary": "Good candidate.",
            "strengths": ["Great communication"],
            "weaknesses": ["Lacks system design"],
            "technical_score": 85,
            "communication_score": 80,
            "confidence_score": 75,
            "key_moments": [],
        }
        mock_compare.return_value = {
            "comparisons": [{"claim": "Python expert", "result": "Proficient", "severity": "low"}]
        }

        # Manually set paths (since we can't upload real files in tests)
        from app.db.dependencies import get_db
        from app.models.candidate import Candidate

        # Get a db session to set paths directly
        for db in get_db():
            candidate = db.query(Candidate).filter(Candidate.id == cid).first()
            candidate.resume_path = "https://storage.example.com/resume.pdf"
            candidate.transcript_path = "https://storage.example.com/transcript.txt"
            db.commit()
            break

        response = client.post(f"/analysis/candidates/{cid}")
        assert response.status_code == 200
        data = response.json()
        assert data["summary"] == "Good candidate."
        assert data["technical_score"] == 85
        assert data["candidate_id"] == cid
        assert "resume_alignment" in data

    def test_analysis_candidate_not_found(self, client):
        response = client.post("/analysis/candidates/9999")
        assert response.status_code == 400
