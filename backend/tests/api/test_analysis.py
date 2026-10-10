"""Analysis API: async job flow for both the legacy candidate endpoint and interviews."""

from unittest.mock import patch

from app.ai.schemas import (
    CitedPoint,
    ClaimCheckOut,
    InterviewAnalysisOut,
    InterviewNotesOut,
    KeyMoment,
)
from app.models.job import Job
from tests.factories import SEGMENTS, make_candidate, make_interview, make_role

P = "app.services.analysis_service"


def _ready(db, org, resume=True, segments=SEGMENTS):
    role = make_role(db, org.id)
    cand = make_candidate(db, org.id, role.id, resume_path="k/r.pdf" if resume else None)
    iv = make_interview(db, org.id, cand, segments)
    return cand, iv


def _good_analysis(iv):
    cand_line = next(s.id for s in iv.segments if s.speaker_kind == "candidate")
    return InterviewAnalysisOut(
        summary="Good candidate.",
        strengths=[CitedPoint(text="Great communication", segment_ids=[cand_line])],
        weaknesses=[],
        key_moments=[KeyMoment(moment="Compiler", signal="positive", segment_id=cand_line)],
        technical_score=85,
        communication_score=80,
        confidence_score=75,
        hiring_recommendation="Hire",
    )


NOTES = InterviewNotesOut(summary="n", key_points=[], topics=[], follow_ups=[])


class TestInterviewAnalysis:
    def test_missing_resume_rejected(self, client, db_session, org):
        _, iv = _ready(db_session, org, resume=False)
        r = client.post(f"/interviews/{iv.id}/analysis")
        assert r.status_code == 422 and r.json()["code"] == "no_resume"

    def test_missing_transcript_rejected(self, client, db_session, org):
        _, iv = _ready(db_session, org, segments=[])
        r = client.post(f"/interviews/{iv.id}/analysis")
        assert r.status_code == 422 and r.json()["code"] == "no_transcript"

    def test_unmapped_speakers_rejected(self, client, db_session, org):
        _, iv = _ready(db_session, org, segments=[("Speaker 1", "unknown", "hi")])
        r = client.post(f"/interviews/{iv.id}/analysis")
        assert r.status_code == 422 and r.json()["code"] == "speakers_unmapped"

    @patch(f"{P}.generate_interview_notes", return_value=NOTES)
    @patch(f"{P}.check_resume_claims", return_value=ClaimCheckOut(comparisons=[]))
    @patch(f"{P}.extract_text_from_pdf", return_value="resume")
    def test_success_202_then_completed_with_analysis_and_notes(
        self, m_pdf, m_claims, m_notes, client, db_session, org
    ):
        _, iv = _ready(db_session, org)
        with patch(f"{P}.generate_interview_analysis", return_value=_good_analysis(iv)):
            r = client.post(f"/interviews/{iv.id}/analysis")
        assert r.status_code == 202 and r.json()["status"] == "queued"

        status = client.get(f"/interviews/{iv.id}/analysis/status").json()
        assert status["status"] == "completed" and status["analysis_id"]

        a = client.get(f"/interviews/{iv.id}/analysis").json()
        assert a["summary"] == "Good candidate." and a["interview_id"] == iv.id
        assert a["strengths"][0]["segment_ids"]  # citations are linkable
        assert a["key_moments"][0]["timestamp_ms"] == 10_000

        detail = client.get(f"/interviews/{iv.id}").json()
        assert detail["analysis_status"] == "completed" and detail["notes"]["summary"] == "n"

    @patch(f"{P}.generate_interview_notes", return_value=NOTES)
    @patch(f"{P}.extract_text_from_pdf", return_value="resume")
    def test_llm_failure_retries_three_times_then_marks_failed(
        self, m_pdf, m_notes, client, db_session, org
    ):
        _, iv = _ready(db_session, org)
        with patch(f"{P}.generate_interview_analysis", side_effect=RuntimeError("llm down")) as gen:
            r = client.post(f"/interviews/{iv.id}/analysis")
            assert r.status_code == 202
            assert gen.call_count == 4  # first attempt + 3 retries
        status = client.get(f"/interviews/{iv.id}/analysis/status").json()
        assert status["status"] == "failed" and "llm down" in status["error"]

    def test_duplicate_request_while_running_conflicts(self, client, db_session, org):
        _, iv = _ready(db_session, org)
        db_session.add(
            Job(org_id=org.id, kind="analysis", entity_type="interview", entity_id=iv.id, status="running")
        )
        db_session.commit()
        r = client.post(f"/interviews/{iv.id}/analysis")
        assert r.status_code == 409 and r.json()["code"] == "job_in_progress"

    def test_no_analysis_yet_is_404(self, client, db_session, org):
        _, iv = _ready(db_session, org)
        assert client.get(f"/interviews/{iv.id}/analysis").status_code == 404
        assert client.get(f"/interviews/{iv.id}/analysis/status").json()["status"] == "none"

    def test_other_orgs_interview_is_404(self, other_client, db_session, org):
        _, iv = _ready(db_session, org)
        assert other_client.post(f"/interviews/{iv.id}/analysis").status_code == 404
        assert other_client.get(f"/interviews/{iv.id}/analysis").status_code == 404

    def test_only_recruiters_can_request(self, role_client, db_session, org):
        _, iv = _ready(db_session, org)
        assert role_client("hiring_manager").post(f"/interviews/{iv.id}/analysis").status_code == 403


class TestLegacyCandidateEndpoint:
    def test_requires_resume_then_transcript(self, client, db_session, org):
        role = make_role(db_session, org.id)
        cand = make_candidate(db_session, org.id, role.id)
        assert client.post(f"/analysis/candidates/{cand.id}").json()["code"] == "no_resume"
        cand.resume_path = "k/r.pdf"
        db_session.commit()
        assert client.post(f"/analysis/candidates/{cand.id}").json()["code"] == "no_transcript"

    def test_candidate_not_found(self, client):
        assert client.post("/analysis/candidates/9999").status_code == 404

    @patch(f"{P}.generate_interview_notes", return_value=NOTES)
    @patch(f"{P}.check_resume_claims", return_value=ClaimCheckOut(comparisons=[]))
    @patch(f"{P}.extract_text_from_pdf", return_value="resume")
    def test_analyses_newest_interview_and_shows_in_candidate_detail(
        self, m_pdf, m_claims, m_notes, client, db_session, org
    ):
        cand, iv = _ready(db_session, org)
        with patch(f"{P}.generate_interview_analysis", return_value=_good_analysis(iv)):
            assert client.post(f"/analysis/candidates/{cand.id}").status_code == 202
        status = client.get(f"/analysis/candidates/{cand.id}/status").json()
        assert status["status"] == "completed"
        detail = client.get(f"/candidates/{cand.id}").json()
        assert detail["analysis"]["interview_id"] == iv.id
        assert detail["analysis"]["hiring_recommendation"] == "Hire"

    def test_status_none_before_any_run_and_cross_org_404(self, client, other_client, db_session, org):
        cand, _ = _ready(db_session, org)
        assert client.get(f"/analysis/candidates/{cand.id}/status").json()["status"] == "none"
        assert other_client.get(f"/analysis/candidates/{cand.id}/status").status_code == 404
        assert other_client.post(f"/analysis/candidates/{cand.id}").status_code == 404
