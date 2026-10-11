"""M10a: in-app notifications, retention, erasure, org export, candidate notice."""

import io
import json
import time
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from moto import mock_aws

from app.ai import llm
from app.ai.resume_parser import cache_key_for, extract_resume_profile
from app.core import email as mailer
from app.core import security, storage
from app.core.config import settings
from app.models.ai_run import AIRun
from app.models.analysis import Analysis
from app.models.calendar import CalendarEvent
from app.models.candidate import Candidate
from app.models.interview import (
    BotSession, Interview, InterviewNote, Recording, SpeakerEvent, TranscriptSegment,
)
from app.models.job import Job
from app.models.notification import Notification
from app.models.rubric import CandidateReveal, RoleMatch
from app.models.tenancy import AuditLog, Invitation, RefreshToken
from app.services import export_service, notification_service, retention_service
from tests.calendar_helpers import make_connection
from tests.factories import SEGMENTS, make_candidate, make_interview, make_role

NOW = datetime.now(UTC)
OLD = NOW - timedelta(days=400)


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


@pytest.fixture()
def role(db_session, org):
    return make_role(db_session, org.id, "Rust Engineer")


@pytest.fixture()
def cand(db_session, org, role):
    return make_candidate(db_session, org.id, role.id, "cara@example.com", name="Cara Candidate")


def blob(key: str, data=b"x"):
    storage.put(key, data, "application/octet-stream")
    return key


def keys_exist(*keys):
    return [storage.exists(k) for k in keys]


# ── notifications ─────────────────────────────────────────────────────────────
class TestNotifications:
    def test_list_unread_count_and_mark_read(self, client, db_session, org, user):
        for i in range(3):
            notification_service.notify(db_session, org.id, user.id, "t", f"n{i}", link=f"/x/{i}")
        assert client.get("/notifications/unread-count").json() == {"count": 3}
        items = client.get("/notifications").json()
        assert [n["title"] for n in items] == ["n2", "n1", "n0"]  # newest first
        assert items[0]["read"] is False and items[0]["link"] == "/x/2"
        assert client.post(f"/notifications/{items[0]['id']}/read").status_code == 204
        assert client.get("/notifications/unread-count").json()["count"] == 2
        assert [n["title"] for n in client.get("/notifications?unread_only=true").json()] == ["n1", "n0"]
        assert client.post("/notifications/read-all").json() == {"updated": 2}
        assert client.get("/notifications/unread-count").json()["count"] == 0

    def test_notifications_are_personal_and_org_scoped(self, client, role_client, other_client, db_session, org, user):
        n = notification_service.notify(db_session, org.id, user.id, "t", "mine")
        peer = role_client("recruiter")
        assert peer.get("/notifications").json() == []
        assert peer.post(f"/notifications/{n.id}/read").status_code == 404  # cannot clear someone else's
        assert other_client.post(f"/notifications/{n.id}/read").status_code == 404
        assert client.get("/notifications/unread-count").json()["count"] == 1

    def test_limit_is_bounded(self, client, db_session, org, user):
        for i in range(5):
            notification_service.notify(db_session, org.id, user.id, "t", f"n{i}")
        assert len(client.get("/notifications?limit=2").json()) == 2
        assert client.get("/notifications?limit=1000").status_code == 422

    def test_notify_without_a_recipient_is_a_noop_and_never_raises(self, db_session, org):
        assert notification_service.notify(db_session, org.id, None, "t", "x") is None
        assert db_session.query(Notification).count() == 0

    def test_requester_is_told_when_analysis_finishes_and_when_it_fails(self, client, db_session, org, user, cand):
        iv = make_interview(db_session, org.id, cand, SEGMENTS)
        cand.resume_path = "k/r.pdf"
        db_session.commit()
        A = "app.services.analysis_service"
        from app.ai.schemas import ClaimCheckOut, InterviewAnalysisOut, InterviewNotesOut
        notes = InterviewNotesOut(summary="s", key_points=[], topics=[], follow_ups=[])
        good = InterviewAnalysisOut(summary="ok", strengths=[], weaknesses=[], key_moments=[],
                                    technical_score=70, communication_score=70, confidence_score=70,
                                    hiring_recommendation="Hire")
        with patch(f"{A}.generate_interview_notes", return_value=notes), patch(
            f"{A}.check_resume_claims", return_value=ClaimCheckOut(comparisons=[])), patch(
            f"{A}.extract_text_from_pdf", return_value="resume"), patch(
            f"{A}.generate_interview_analysis", return_value=good):
            assert client.post(f"/interviews/{iv.id}/analysis").status_code == 202
        n = client.get("/notifications").json()[0]
        assert n["title"] == "Interview analysis is ready" and n["link"] == f"/interviews/{iv.id}?tab=analysis"

        with patch(f"{A}.generate_interview_notes", return_value=notes), patch(
            f"{A}.extract_text_from_pdf", return_value="resume"), patch(
            f"{A}.generate_interview_analysis", side_effect=RuntimeError("boom sk-proj-abcdefghijklmnop123")):
            client.post(f"/interviews/{iv.id}/analysis")
        failed = client.get("/notifications").json()[0]
        assert failed["title"] == "Interview analysis failed"
        assert "abcdefghijklmnop" not in (failed["body"] or "") and "boom" in failed["body"]

    def test_jobs_without_a_requester_notify_nobody_and_terminal_states_notify_once(self, db_session, org, user):
        from app.services import job_service
        auto = job_service.create(db_session, org.id, "rank", "role", 1)  # auto re-rank: no requester
        job_service.set_status(db_session, auto.id, "completed", result={"scored": 2})
        assert db_session.query(Notification).count() == 0
        mine = job_service.create(db_session, org.id, "rank", "role", 2, requested_by=user.id)
        job_service.set_status(db_session, mine.id, "running")
        job_service.set_status(db_session, mine.id, "completed", result={"scored": 7})
        job_service.set_status(db_session, mine.id, "completed", result={"scored": 7})
        notes = db_session.query(Notification).all()
        assert len(notes) == 1 and notes[0].title == "Ranking finished" and "7 candidates" in notes[0].body
        assert notes[0].link == "/roles/2?tab=ranking"

    def test_bot_failure_notifies_the_interview_creator(self, client, db_session, org, user, cand):
        iv = make_interview(db_session, org.id, cand, platform="google_meet",
                            meeting_url="https://meet.google.com/abc-defg-hij", created_by_user_id=user.id)
        s = BotSession(org_id=org.id, interview_id=iv.id, status="joining")
        db_session.add(s)
        db_session.commit()
        body = json.dumps({"type": "failed", "reason": "admission_timeout", "detail": "no one let me in"}).encode()
        ts = str(int(time.time()))
        r = client.post(f"/internal/bots/{s.id}/events", content=body, headers={
            "X-Timestamp": ts, "X-Signature": security.sign_body(security.derive_bot_secret(s.id), body, ts),
            "Authorization": "", "X-Org-Id": ""})
        assert r.status_code == 200
        n = client.get("/notifications").json()[0]
        assert "could not record" in n["title"] and "admission_timeout" in n["body"] and n["link"] == f"/interviews/{iv.id}"

    def test_calendar_reconnect_needed_notifies_the_owner_once(self, db_session, org, user):
        from app.services import calendar_service
        conn = make_connection(db_session, org, user)
        calendar_service._mark_reauth(db_session, conn, "revoked")
        calendar_service._mark_reauth(db_session, conn, "revoked again")
        notes = db_session.query(Notification).filter_by(kind="calendar_reauth").all()
        assert len(notes) == 1 and notes[0].link == "/settings?tab=integrations"


# ── retention ─────────────────────────────────────────────────────────────────
class TestRetention:
    def _old_interview(self, db, org, cand, **kw):
        iv = make_interview(db, org.id, cand, SEGMENTS, scheduled_start=kw.pop("start", OLD), **kw)
        rec = blob(f"{org.id}/recordings/{iv.id}/full.ogg")
        db.add(Recording(org_id=org.id, interview_id=iv.id, blob_path=rec, mime_type="audio/ogg"))
        db.add(SpeakerEvent(interview_id=iv.id, t_ms=0, speaker_name="Priya"))
        chunk, shot = blob(f"{org.id}/recordings/{iv.id}/0000.opus"), blob(f"{org.id}/recordings/{iv.id}/f.png")
        db.add(BotSession(org_id=org.id, interview_id=iv.id, status="completed",
                          chunks=[{"index": 0, "blob": chunk}], screenshot_key=shot))
        db.add(InterviewNote(org_id=org.id, interview_id=iv.id, summary="kept", key_points=[], topics=[], follow_ups=[]))
        db.add(Analysis(org_id=org.id, interview_id=iv.id, candidate_id=cand.id, summary="kept", strengths=[],
                        weaknesses=[], technical_score=1, communication_score=1, confidence_score=1))
        db.commit()
        return iv, [rec, chunk, shot]

    def test_old_interviews_lose_recordings_and_transcripts_but_keep_notes_and_analysis(self, s3, db_session, org, cand):
        iv, keys = self._old_interview(db_session, org, cand)
        r = retention_service.purge_org(db_session, org)
        assert r["interviews"] == 1 and r["recordings"] == 1 and r["segments"] == 4 and r["blobs"] == 3
        db_session.expire_all()
        assert db_session.query(TranscriptSegment).count() == 0 and db_session.query(SpeakerEvent).count() == 0
        assert db_session.query(Recording).count() == 0 and keys_exist(*keys) == [False, False, False]
        assert db_session.get(Interview, iv.id).transcript_purged_at is not None
        assert db_session.query(InterviewNote).count() == 1 and db_session.query(Analysis).count() == 1
        s = db_session.query(BotSession).one()
        assert s.chunks == [] and s.screenshot_key is None

    def test_recent_interviews_are_untouched_and_a_second_run_is_a_noop(self, s3, db_session, org, cand):
        recent, rkeys = self._old_interview(db_session, org, cand, start=NOW - timedelta(days=10))
        old, _ = self._old_interview(db_session, org, cand)
        assert retention_service.purge_org(db_session, org)["interviews"] == 1
        assert retention_service.purge_org(db_session, org)["interviews"] == 0
        db_session.expire_all()
        assert db_session.get(Interview, recent.id).transcript_purged_at is None
        assert keys_exist(*rkeys) == [True, True, True]
        assert db_session.query(TranscriptSegment).filter_by(interview_id=recent.id).count() == 4

    def test_each_org_uses_its_own_retention_window(self, s3, db_session, org, other_org, cand):
        org.data_retention_days, other_org.data_retention_days = 30, 365
        theirs = make_candidate(db_session, other_org.id, make_role(db_session, other_org.id, "R").id, "z@x.com")
        mine, _ = self._old_interview(db_session, org, cand, start=NOW - timedelta(days=90))
        other = make_interview(db_session, other_org.id, theirs, SEGMENTS, scheduled_start=NOW - timedelta(days=90))
        db_session.commit()
        summary = retention_service.run_nightly(db_session)
        assert summary["orgs"][org.id]["interviews"] == 1 and summary["orgs"][other_org.id]["interviews"] == 0
        db_session.expire_all()
        assert db_session.get(Interview, other.id).transcript_purged_at is None
        assert db_session.query(TranscriptSegment).filter_by(interview_id=other.id).count() == 4
        assert db_session.get(Interview, mine.id).transcript_purged_at is not None

    def test_meetings_still_being_processed_are_never_purged(self, s3, db_session, org, cand):
        for status in ("in_progress", "processing"):
            self._old_interview(db_session, org, cand, status=status)
        assert retention_service.purge_org(db_session, org)["interviews"] == 0

    def test_interviews_without_a_start_time_age_from_creation(self, s3, db_session, org, cand):
        iv, _ = self._old_interview(db_session, org, cand, start=None)
        iv.created_at = OLD
        db_session.commit()
        assert retention_service.purge_org(db_session, org)["interviews"] == 1

    def test_legacy_transcript_file_goes_only_when_no_live_interview_remains(self, s3, db_session, org, cand):
        cand.transcript_path = blob(f"{org.id}/transcripts/legacy.txt")
        iv, _ = self._old_interview(db_session, org, cand)
        retention_service.purge_org(db_session, org)
        db_session.refresh(cand)
        assert cand.transcript_path is None and not storage.exists(f"{org.id}/transcripts/legacy.txt")

        keep = make_candidate(db_session, org.id, cand.role_id, "keep@x.com")
        keep.transcript_path = blob(f"{org.id}/transcripts/keep.txt")
        self._old_interview(db_session, org, keep)
        make_interview(db_session, org.id, keep, SEGMENTS, scheduled_start=NOW)  # a live one
        retention_service.purge_org(db_session, org)
        db_session.refresh(keep)
        assert keep.transcript_path is not None and storage.exists(f"{org.id}/transcripts/keep.txt")

    def test_purge_is_audited_without_personal_data(self, s3, db_session, org, cand):
        self._old_interview(db_session, org, cand)
        retention_service.purge_org(db_session, org)
        a = db_session.query(AuditLog).filter_by(action="retention.purged").one()
        assert a.user_id is None and a.metadata_["interviews"] == 1 and a.metadata_["retention_days"] == 365
        assert "Cara" not in json.dumps(a.metadata_)

    def test_api_exposes_the_purged_flag_and_recording_is_gone(self, s3, client, db_session, org, cand):
        iv, _ = self._old_interview(db_session, org, cand)
        retention_service.purge_org(db_session, org)
        d = client.get(f"/interviews/{iv.id}").json()
        assert d["transcript_purged"] is True and d["segment_count"] == 0 and d["has_recording"] is False
        assert client.get(f"/interviews/{iv.id}/recording").json()["code"] == "no_recording"
        assert d["notes"]["summary"] == "kept"

    def test_one_failing_org_does_not_stop_the_others(self, s3, db_session, org, other_org, cand):
        self._old_interview(db_session, org, cand)
        real = retention_service.purge_org

        def flaky(db, o, now=None):
            if o.id == org.id:
                raise RuntimeError("db hiccup")
            return real(db, o, now)

        with patch("app.services.retention_service.purge_org", side_effect=flaky):
            summary = retention_service.run_nightly(db_session)
        assert org.id not in summary["orgs"] and other_org.id in summary["orgs"]

    def test_cached_ai_results_expire_but_cost_rows_stay(self, db_session, org):
        def run(days):
            r = AIRun(org_id=org.id, purpose="analysis", model="m", prompt_version="v", status="ok",
                      cost_usd=1, result={"summary": "contains resume text"})
            db_session.add(r)
            db_session.commit()
            r.created_at = NOW - timedelta(days=days)
            db_session.commit()
            return r.id
        old, fresh = run(settings.ai_cache_retention_days + 5), run(1)
        assert retention_service.purge_ai_results(db_session) == 1
        db_session.expire_all()
        assert db_session.get(AIRun, old).result is None and float(db_session.get(AIRun, old).cost_usd) == 1
        assert db_session.get(AIRun, fresh).result is not None

    def test_expired_exports_are_deleted_from_storage(self, s3, db_session, org, user):
        k = blob(f"{org.id}/exports/old.zip")
        job = Job(org_id=org.id, kind="export", entity_type="org", entity_id=org.id, status="completed",
                  result={"key": k, "expires_at": (NOW - timedelta(days=1)).isoformat(), "files": 3, "tables": {}})
        live = Job(org_id=org.id, kind="export", entity_type="org", entity_id=org.id, status="completed",
                   result={"key": blob(f"{org.id}/exports/live.zip"), "expires_at": (NOW + timedelta(days=3)).isoformat()})
        db_session.add_all([job, live])
        db_session.commit()
        assert retention_service.expire_exports(db_session) == 1
        db_session.refresh(job)
        assert not storage.exists(k) and job.result["expired"] is True and storage.exists(f"{org.id}/exports/live.zip")

    def test_stale_auth_rows_are_cleaned(self, db_session, org, user):
        old, fresh = NOW - timedelta(days=90), NOW + timedelta(days=5)
        db_session.add_all([
            RefreshToken(user_id=user.id, token_hash="a", expires_at=old),
            RefreshToken(user_id=user.id, token_hash="b", expires_at=fresh),
            Invitation(org_id=org.id, email="a@x.com", role="recruiter", token="t1", expires_at=old),
        ])
        db_session.commit()
        assert retention_service.cleanup_auth(db_session) == 2
        assert [t.token_hash for t in db_session.query(RefreshToken)] == ["b"]

    def test_nightly_job_is_scheduled_at_03_utc(self):
        from app.worker.celery_app import celery_app
        sched = celery_app.conf.beat_schedule["retention-nightly"]
        assert sched["task"] == "compliance.retention_nightly"
        assert sched["schedule"].hour == {3} and sched["schedule"].minute == {0}


# ── erasure ───────────────────────────────────────────────────────────────────
class TestErasure:
    def _populate(self, db, org, role, user, cand):
        cand.resume_path = blob(f"{org.id}/resumes/r.pdf")
        cand.avatar_path = blob(f"{org.id}/avatars/a.png")
        cand.transcript_path = blob(f"{org.id}/transcripts/t.txt")
        iv = make_interview(db, org.id, cand, SEGMENTS)
        rec = blob(f"{org.id}/recordings/{iv.id}/full.ogg")
        db.add(Recording(org_id=org.id, interview_id=iv.id, blob_path=rec, mime_type="audio/ogg"))
        db.add(SpeakerEvent(interview_id=iv.id, t_ms=1, speaker_name="Cara"))
        db.add(BotSession(org_id=org.id, interview_id=iv.id, status="completed",
                          screenshot_key=blob(f"{org.id}/recordings/{iv.id}/shot.png")))
        db.add(InterviewNote(org_id=org.id, interview_id=iv.id, summary="Cara did well", key_points=[], topics=[], follow_ups=[]))
        db.add(Analysis(org_id=org.id, interview_id=iv.id, candidate_id=cand.id, summary="about Cara", strengths=[],
                        weaknesses=[], technical_score=1, communication_score=1, confidence_score=1))
        db.add(RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=role.id, status="scored", overall_score=70.0))
        db.add(CandidateReveal(org_id=org.id, user_id=user.id, candidate_id=cand.id))
        conn = make_connection(db, org, user)
        db.add(CalendarEvent(org_id=org.id, connection_id=conn.id, external_id="e1", title="Interview Cara",
                             start=NOW, candidate_id=cand.id, interview_id=iv.id, attendees=[{"email": cand.email}]))
        db.add(Notification(org_id=org.id, user_id=user.id, kind="analysis", title="ready", link=f"/interviews/{iv.id}?tab=analysis"))
        mine = AIRun(org_id=org.id, purpose="analysis", model="m", prompt_version="v", status="ok", cost_usd=2,
                     result={"summary": "Cara..."}, candidate_id=cand.id)
        db.add(mine)
        db.commit()
        return iv, [cand.resume_path, cand.avatar_path, cand.transcript_path, rec]

    def test_confirmation_is_required(self, client, cand):
        r = client.post(f"/candidates/{cand.id}/erase", json={})
        assert r.status_code == 422 and r.json()["code"] == "confirm_required"
        assert client.get(f"/candidates/{cand.id}").status_code == 200

    def test_everything_about_the_candidate_is_removed(self, s3, client, db_session, org, role, user, cand):
        bystander = make_candidate(db_session, org.id, role.id, "other@x.com", name="Other Person")
        other_iv = make_interview(db_session, org.id, bystander, SEGMENTS)
        keep_run = AIRun(org_id=org.id, purpose="analysis", model="m", prompt_version="v", status="ok",
                         result={"summary": "Other"}, candidate_id=bystander.id)
        db_session.add(keep_run)
        iv, keys = self._populate(db_session, org, role, user, cand)
        cid, ivid = cand.id, iv.id

        r = client.post(f"/candidates/{cid}/erase", json={"confirm": True})

        assert r.status_code == 200
        receipt = r.json()
        assert receipt["candidate_id"] == cid and receipt["interviews"] == 1 and receipt["recordings"] == 1
        assert receipt["analyses"] == 1 and receipt["files_deleted"] >= 5 and receipt["erased_at"]
        db_session.expire_all()
        assert db_session.get(Candidate, cid) is None
        for model, col in ((Interview, "candidate_id"), (Analysis, "candidate_id"), (RoleMatch, "candidate_id"),
                           (CandidateReveal, "candidate_id"), (CalendarEvent, "candidate_id")):
            assert db_session.query(model).filter(getattr(model, col) == cid).count() == 0
        for model in (TranscriptSegment, SpeakerEvent, Recording, InterviewNote, BotSession):
            assert db_session.query(model).filter(model.interview_id == ivid).count() == 0
        assert keys_exist(*keys) == [False] * 4
        assert db_session.query(Notification).filter(Notification.link.like(f"/interviews/{ivid}%")).count() == 0
        # cached AI text is scrubbed, but cost accounting survives
        scrubbed = db_session.query(AIRun).filter(AIRun.cost_usd == 2).one()
        assert scrubbed.result is None and scrubbed.candidate_id is None
        # other people's data is untouched
        assert db_session.get(Candidate, bystander.id) is not None
        assert db_session.query(TranscriptSegment).filter_by(interview_id=other_iv.id).count() == 4
        assert db_session.get(AIRun, keep_run.id).result == {"summary": "Other"}

    def test_the_audit_trail_records_the_erasure_without_personal_data(self, s3, client, db_session, org, role, user, cand):
        self._populate(db_session, org, role, user, cand)
        cid = cand.id
        client.post(f"/candidates/{cid}/erase", json={"confirm": True})
        a = db_session.query(AuditLog).filter_by(action="candidate.erased").one()
        assert a.entity_id == str(cid) and a.user_id == user.id
        blob_ = json.dumps(a.metadata_)
        assert "Cara" not in blob_ and "cara@example.com" not in blob_ and a.metadata_["interviews"] == 1

    def test_plain_delete_is_just_as_thorough_and_audited_separately(self, s3, client, db_session, org, role, user, cand):
        iv, keys = self._populate(db_session, org, role, user, cand)
        ivid, cid = iv.id, cand.id
        assert client.delete(f"/candidates/{cid}").status_code == 204
        db_session.expire_all()
        assert db_session.query(SpeakerEvent).filter_by(interview_id=ivid).count() == 0
        assert db_session.query(RoleMatch).filter_by(candidate_id=cid).count() == 0
        assert keys_exist(*keys) == [False] * 4
        assert db_session.query(AuditLog).filter_by(action="candidate.deleted").count() == 1

    def test_permissions_and_isolation(self, s3, role_client, other_client, db_session, org, cand):
        body = {"confirm": True}
        for r in ("interviewer", "hiring_manager"):
            assert role_client(r).post(f"/candidates/{cand.id}/erase", json=body).status_code == 403
        assert other_client.post(f"/candidates/{cand.id}/erase", json=body).status_code == 404
        assert role_client("recruiter").post(f"/candidates/{cand.id}/erase", json=body).status_code == 200

    def test_resume_parse_runs_are_tagged_with_the_candidate_so_they_can_be_scrubbed(self, db_session, org):
        from app.ai.schemas import ResumeProfileOut

        real = ResumeProfileOut.model_validate({
            "basics": {"full_name": "A", "headline": "", "email": "", "phone": ""}, "summary": "", "education": [],
            "experience": [], "projects": [], "skills": {"programming_languages": [], "frameworks": [], "databases": [], "tools": []},
            "metadata": {"resume_pages": 1, "total_experience_years": 1}})
        client = MagicMock()
        client.chat.completions.parse.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(parsed=real, refusal=None))],
            usage=MagicMock(prompt_tokens=1, completion_tokens=1))
        with patch("app.ai.llm.get_client", return_value=client):
            extract_resume_profile("some resume text", org.id, candidate_id=42)
        run = db_session.query(AIRun).one()
        assert run.candidate_id == 42 and run.cache_key == cache_key_for("some resume text", org.id)
        from app.ai.prompts import resume_parse_v1

        assert llm.cache_key(org.id, "resume_parse", run.prompt_version, run.model,
                             resume_parse_v1.build_messages("some resume text")) == run.cache_key


# ── export ────────────────────────────────────────────────────────────────────
def zip_of(key: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(storage.get(key)))


class TestExport:
    @pytest.fixture()
    def populated(self, s3, db_session, org, role, user, cand):
        cand.resume_path = blob(f"{org.id}/resumes/r.pdf", b"%PDF resume bytes")
        cand.avatar_path = blob(f"{org.id}/avatars/a.png", b"png")
        iv = make_interview(db_session, org.id, cand, SEGMENTS)
        db_session.add(SpeakerEvent(interview_id=iv.id, t_ms=5, speaker_name="Priya"))
        rec = blob(f"{org.id}/recordings/{iv.id}/full.ogg", b"AUDIO")
        db_session.add(Recording(org_id=org.id, interview_id=iv.id, blob_path=rec, mime_type="audio/ogg"))
        db_session.add(AIRun(org_id=org.id, purpose="analysis", model="m", prompt_version="v", status="ok",
                             result={"secret": "cached text"}, cache_key="ck"))
        db_session.add(Invitation(org_id=org.id, email="x@x.com", role="recruiter", token="SECRET-INVITE", expires_at=NOW))
        make_connection(db_session, org, user)
        db_session.commit()
        return iv

    def test_admin_requests_then_downloads_a_zip_of_everything(self, client, populated, user, db_session, org, cand):
        r = client.post(f"/orgs/{org.id}/exports", json={})
        assert r.status_code == 202 and r.json()["status"] == "queued"
        st = client.get(f"/orgs/{org.id}/exports/latest").json()
        assert st["status"] == "completed" and st["size_bytes"] > 0 and st["files"] == 2 and st["url"] is None
        assert st["include_recordings"] is False and st["expires_at"]

        dl = client.get(f"/orgs/{org.id}/exports/latest?download=true").json()
        assert "X-Amz-Signature" in dl["url"]
        key = db_session.query(Job).filter_by(kind="export").one().result["key"]
        z = zip_of(key)
        names = set(z.namelist())
        assert {"README.txt", "data/candidates.json", "data/interviews.json", "data/transcript_segments.json",
                "data/members.json", "data/organization.json"} <= names
        assert f"files/resumes/{cand.id}-r.pdf" in names and z.read(f"files/resumes/{cand.id}-r.pdf") == b"%PDF resume bytes"
        assert not any(n.startswith("files/recordings/") for n in names)
        cands = json.loads(z.read("data/candidates.json"))
        assert [c["email"] for c in cands] == ["cara@example.com"]
        assert len(json.loads(z.read("data/transcript_segments.json"))) == 4
        assert json.loads(z.read("data/speaker_events.json"))[0]["speaker_name"] == "Priya"
        members = json.loads(z.read("data/members.json"))
        assert members[0]["email"] == user.email and "password_hash" not in members[0]
        assert db_session.query(AuditLog).filter_by(action="export.downloaded").count() == 1
        assert db_session.query(AuditLog).filter_by(action="export.requested").count() == 1

    def test_secrets_never_reach_the_archive(self, client, populated, db_session, org):
        client.post(f"/orgs/{org.id}/exports", json={})
        z = zip_of(db_session.query(Job).filter_by(kind="export").one().result["key"])
        everything = b"".join(z.read(n) for n in z.namelist() if n.startswith("data/")).decode()
        for forbidden in ("SECRET-INVITE", "cached text", "password_hash", "access_token_enc", "refresh_token_enc",
                          "at-old", "rt-old", "token_hash", "embedding", "cache_key", "container_ref"):
            assert forbidden not in everything, forbidden
        assert "data/calendar_connections.json" in z.namelist()  # included, minus the tokens

    def test_recordings_are_included_only_when_asked(self, client, populated, db_session, org):
        client.post(f"/orgs/{org.id}/exports", json={"include_recordings": True})
        job = db_session.query(Job).filter_by(kind="export").order_by(Job.id.desc()).first()
        z = zip_of(job.result["key"])
        rec = [n for n in z.namelist() if n.startswith("files/recordings/")]
        assert len(rec) == 1 and z.read(rec[0]) == b"AUDIO" and job.result["include_recordings"] is True

    def test_other_orgs_data_is_never_included(self, client, populated, db_session, other_org):
        theirs = make_candidate(db_session, other_org.id, make_role(db_session, other_org.id, "R").id, "secret@other.com")
        theirs.resume_path = blob(f"{other_org.id}/resumes/theirs.pdf", b"THEIRS")
        db_session.commit()
        from app.models.tenancy import Organization
        org_id = db_session.query(Organization).filter(Organization.id != other_org.id).first().id
        client.post(f"/orgs/{org_id}/exports", json={})
        z = zip_of(db_session.query(Job).filter_by(kind="export", org_id=org_id).one().result["key"])
        blob_ = b"".join(z.read(n) for n in z.namelist()).decode(errors="ignore")
        assert "secret@other.com" not in blob_ and "THEIRS" not in blob_

    def test_a_missing_blob_does_not_fail_the_export(self, client, db_session, org, role, cand, s3):
        cand.resume_path = f"{org.id}/resumes/does-not-exist.pdf"
        db_session.commit()
        client.post(f"/orgs/{org.id}/exports", json={})
        assert client.get(f"/orgs/{org.id}/exports/latest").json()["status"] == "completed"

    def test_requester_is_notified_when_it_is_ready(self, client, populated, org):
        client.post(f"/orgs/{org.id}/exports", json={})
        n = client.get("/notifications").json()[0]
        assert n["title"] == "Your data export is ready" and n["link"] == "/settings?tab=privacy"

    def test_admin_only_rate_limited_and_scoped_to_the_org(self, client, role_client, other_client, org, other_org):
        recruiter = role_client("recruiter")
        assert recruiter.post(f"/orgs/{org.id}/exports", json={}).status_code == 403
        assert recruiter.get(f"/orgs/{org.id}/exports/latest").status_code == 403
        assert other_client.post(f"/orgs/{org.id}/exports", json={}).status_code == 403
        with patch.object(settings, "limit_export_per_hour", 1), patch.object(export_service, "build_export", side_effect=RuntimeError("x")):
            assert client.post(f"/orgs/{org.id}/exports", json={}).status_code == 202
            assert client.post(f"/orgs/{org.id}/exports", json={}).status_code == 429

    def test_failure_is_reported_and_a_second_export_can_follow(self, client, db_session, org, s3):
        with patch.object(export_service, "build_export", side_effect=RuntimeError("disk full")):
            client.post(f"/orgs/{org.id}/exports", json={})
        st = client.get(f"/orgs/{org.id}/exports/latest").json()
        assert st["status"] == "failed" and "disk full" in st["error"]
        client.post(f"/orgs/{org.id}/exports", json={})
        assert client.get(f"/orgs/{org.id}/exports/latest").json()["status"] == "completed"

    def test_status_none_and_expired(self, client, db_session, org):
        assert client.get(f"/orgs/{org.id}/exports/latest").json()["status"] == "none"
        db_session.add(Job(org_id=org.id, kind="export", entity_type="org", entity_id=org.id, status="completed",
                           result={"expired": True}))
        db_session.commit()
        assert client.get(f"/orgs/{org.id}/exports/latest").json()["status"] == "expired"
        assert client.get(f"/orgs/{org.id}/exports/latest?download=true").json()["status"] == "expired"

    def test_duplicate_request_while_running_conflicts(self, client, db_session, org):
        db_session.add(Job(org_id=org.id, kind="export", entity_type="org", entity_id=org.id, status="running"))
        db_session.commit()
        r = client.post(f"/orgs/{org.id}/exports", json={})
        assert r.status_code == 409 and r.json()["code"] == "job_in_progress"


# ── candidate notice ──────────────────────────────────────────────────────────
class TestNotifyCandidate:
    def _iv(self, db, org, cand, **kw):
        return make_interview(db, org.id, cand, platform="google_meet",
                              meeting_url="https://meet.google.com/abc-defg-hij",
                              scheduled_start=NOW + timedelta(days=2), **kw)

    def test_email_has_time_link_and_the_orgs_recording_notice(self, client, db_session, org, cand):
        client.patch(f"/orgs/{org.id}/settings", json={"consent_message": "Acme records calls to take hiring notes."})
        iv = self._iv(db_session, org, cand)
        r = client.post(f"/interviews/{iv.id}/notify-candidate")
        assert r.status_code == 200 and r.json() == {"sent_to": "cara@example.com"}
        mail = mailer.outbox[-1]
        assert mail["to"] == "cara@example.com" and org.name in mail["subject"]
        text = mail["text"]
        assert "https://meet.google.com/abc-defg-hij" in text and "UTC" in text and "Cara Candidate" in text
        assert "recorded and transcribed" in text and "Acme records calls to take hiring notes." in text
        assert db_session.query(AuditLog).filter_by(action="interview.candidate_notified").count() == 1

    def test_default_notice_is_used_when_the_org_has_not_customised_it(self, client, db_session, org, cand):
        client.post(f"/interviews/{self._iv(db_session, org, cand).id}/notify-candidate")
        assert settings.bot_default_consent in mailer.outbox[-1]["text"]

    def test_no_recording_notice_for_interviews_without_a_meeting_link(self, client, db_session, org, cand):
        iv = make_interview(db_session, org.id, cand)
        client.post(f"/interviews/{iv.id}/notify-candidate")
        assert "recorded" not in mailer.outbox[-1]["text"]

    def test_placeholder_addresses_are_refused(self, client, db_session, org, role):
        c = make_candidate(db_session, org.id, role.id, "no-email-abc123@resume.invalid")
        r = client.post(f"/interviews/{self._iv(db_session, org, c).id}/notify-candidate")
        assert r.status_code == 422 and r.json()["code"] == "no_candidate_email" and not mailer.outbox

    def test_permissions_and_isolation(self, role_client, other_client, db_session, org, cand):
        iv = self._iv(db_session, org, cand)
        assert role_client("interviewer").post(f"/interviews/{iv.id}/notify-candidate").status_code == 403
        assert role_client("hiring_manager").post(f"/interviews/{iv.id}/notify-candidate").status_code == 403
        assert other_client.post(f"/interviews/{iv.id}/notify-candidate").status_code == 404
        assert not mailer.outbox


class TestRateLimitsRunAfterAuthorization:
    """A user who is not allowed to do something must not be able to use up the org's quota."""

    def test_forbidden_attempts_do_not_consume_the_export_quota(self, client, role_client, db_session, org, s3):
        recruiter = role_client("recruiter")
        with patch.object(settings, "limit_export_per_hour", 2):
            for _ in range(5):  # a non-admin hammering the endpoint
                assert recruiter.post(f"/orgs/{org.id}/exports", json={}).status_code == 403
            assert client.post(f"/orgs/{org.id}/exports", json={}).status_code == 202
            db_session.query(Job).delete()
            db_session.commit()
            assert client.post(f"/orgs/{org.id}/exports", json={}).status_code == 202
            db_session.query(Job).delete()
            db_session.commit()
            assert client.post(f"/orgs/{org.id}/exports", json={}).status_code == 429  # real quota still works

    def test_forbidden_rank_and_bulk_attempts_do_not_consume_the_quota(self, client, role_client, db_session, org):
        role = make_role(db_session, org.id, "R")
        viewer = role_client("interviewer")
        with patch.object(settings, "limit_rank_per_hour", 1), patch.object(settings, "limit_bulk_per_hour", 1):
            for _ in range(4):
                assert viewer.post(f"/roles/{role.id}/rank").status_code == 403
                assert viewer.post(f"/roles/{role.id}/resumes/bulk", files=[("files", ("a.pdf", b"%PDF", "application/pdf"))]).status_code == 403
            # the rate-limit dependency is only reached by authorised callers: no 429 from the viewer's attempts
            r = client.post(f"/roles/{role.id}/rank")
            assert r.status_code == 422 and r.json()["code"] == "no_rubric"  # reached the handler, not blocked
