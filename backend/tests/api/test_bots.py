"""Notetaker lifecycle: request/stop/queue/schedule, signed internal endpoints."""

import json
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from moto import mock_aws

from app.core import security, storage
from app.core.config import settings
from app.models.interview import BotSession, Interview, SpeakerEvent
from app.services import bot_service
from tests.factories import make_candidate, make_interview, make_role

MEET = "https://meet.google.com/abc-defg-hij"


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


@pytest.fixture()
def launcher():
    fake = MagicMock()
    fake.launch.return_value = "container-123"
    with patch("app.services.bot_service.get_launcher", return_value=fake):
        yield fake


@pytest.fixture()
def cand(db_session, org):
    return make_candidate(db_session, org.id, make_role(db_session, org.id).id)


@pytest.fixture()
def iv(db_session, org, cand):
    return make_interview(db_session, org.id, cand, platform="google_meet", meeting_url=MEET)


def signed(client, method, path, secret, body: dict | None = None, ts=None):
    raw = json.dumps(body).encode() if body is not None else b""
    ts = str(ts or int(time.time()))
    headers = {"X-Timestamp": ts, "X-Signature": security.sign_body(secret, raw, ts),
               "Content-Type": "application/json"}
    return client.request(method, path, content=raw, headers=headers)


def bot(client, session_id, method, suffix, body=None, **kw):
    return signed(client, method, f"/internal/bots/{session_id}/{suffix}",
                  security.derive_bot_secret(session_id), body, **kw)


class TestRequestBot:
    def test_send_now_launches_with_mandatory_consent(self, client, launcher, iv, org):
        r = client.post(f"/interviews/{iv.id}/bot")
        assert r.status_code == 202 and r.json()["status"] == "launching"

        spec = launcher.launch.call_args.args[0]
        assert spec.meeting_url == MEET and spec.bot_name == settings.bot_name
        assert spec.consent_message == settings.bot_default_consent  # never empty
        assert spec.upload_prefix == f"recordings/{r.json()['id']}/"
        assert spec.callback_secret == security.derive_bot_secret(r.json()["id"])
        assert spec.env()["CONSENT_MESSAGE"]

    def test_org_can_reword_consent_and_bot_name_but_not_blank_it(self, client, launcher, iv, org):
        client.patch(f"/orgs/{org.id}/settings", json={"bot_name": "Acme Notes", "consent_message": "Acme records this call for hiring notes."})
        client.post(f"/interviews/{iv.id}/bot")
        spec = launcher.launch.call_args.args[0]
        assert spec.bot_name == "Acme Notes" and spec.consent_message == "Acme records this call for hiring notes."
        # too short to be a real notice -> rejected at the API
        assert client.patch(f"/orgs/{org.id}/settings", json={"consent_message": "hi"}).status_code == 422

    def test_blank_stored_consent_falls_back_to_default(self, db_session, org):
        org.settings = {"consent_message": "   "}
        assert bot_service.consent_message_for(org) == settings.bot_default_consent

    @pytest.mark.parametrize("platform,url", [("upload", None), ("zoom", "https://x.zoom.us/j/1")])
    def test_unsupported_platforms(self, client, db_session, org, cand, launcher, platform, url):
        i = make_interview(db_session, org.id, cand, platform=platform, meeting_url=url)
        r = client.post(f"/interviews/{i.id}/bot")
        assert r.status_code == 422 and r.json()["code"] == "platform_unsupported"
        launcher.launch.assert_not_called()

    def test_teams_interviews_can_get_the_notetaker(self, client, db_session, org, cand, launcher):
        i = make_interview(db_session, org.id, cand, platform="teams",
                           meeting_url="https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0")
        r = client.post(f"/interviews/{i.id}/bot")
        assert r.status_code == 202 and r.json()["status"] == "launching"
        assert launcher.launch.call_args.args[0].meeting_url.startswith("https://teams.microsoft.com/")

    def test_only_one_active_bot(self, client, launcher, iv):
        client.post(f"/interviews/{iv.id}/bot")
        r = client.post(f"/interviews/{iv.id}/bot")
        assert r.status_code == 409 and r.json()["code"] == "bot_active"

    def test_launch_failure_marks_session_failed_and_allows_retry(self, client, launcher, iv):
        launcher.launch.side_effect = RuntimeError("docker down")
        r = client.post(f"/interviews/{iv.id}/bot")
        assert r.json()["status"] == "failed" and r.json()["failure_reason"] == "launch_failed"
        launcher.launch.side_effect = None
        assert client.post(f"/interviews/{iv.id}/bot").json()["status"] == "launching"

    def test_over_capacity_is_queued_then_launched_when_free(self, client, db_session, org, cand, launcher, iv):
        other = make_interview(db_session, org.id, cand, platform="google_meet", meeting_url=MEET, title="busy")
        db_session.add(BotSession(org_id=org.id, interview_id=other.id, status="in_call"))
        db_session.commit()
        with patch.object(settings, "bot_concurrency_per_org", 1):
            r = client.post(f"/interviews/{iv.id}/bot")
            assert r.json()["status"] == "scheduled"  # queued
            launcher.launch.assert_not_called()
            assert bot_service.launch_due(db_session) == 0
            db_session.query(BotSession).filter_by(interview_id=other.id).update({"status": "completed"})
            db_session.commit()
            assert bot_service.launch_due(db_session) == 1
        assert db_session.query(BotSession).filter_by(interview_id=iv.id).one().status == "launching"

    def test_scheduled_mode_launches_one_minute_before_start(self, client, db_session, launcher, iv):
        start = datetime.now(UTC) + timedelta(hours=1)
        iv.scheduled_start = start
        db_session.commit()

        r = client.post(f"/interviews/{iv.id}/bot", json={"mode": "scheduled"})
        assert r.status_code == 202 and r.json()["status"] == "scheduled"
        s = db_session.query(BotSession).one()
        assert abs((s.launch_at.replace(tzinfo=UTC) - (start - timedelta(minutes=1))).total_seconds()) < 2

        assert bot_service.launch_due(db_session) == 0  # not yet
        s.launch_at = datetime.now(UTC) - timedelta(seconds=1)
        db_session.commit()
        assert bot_service.launch_due(db_session) == 1
        launcher.launch.assert_called_once()

    def test_scheduled_mode_needs_a_future_start(self, client, iv):
        r = client.post(f"/interviews/{iv.id}/bot", json={"mode": "scheduled"})
        assert r.status_code == 422 and r.json()["code"] == "bad_schedule"

    def test_roles(self, role_client, iv):
        assert role_client("interviewer").post(f"/interviews/{iv.id}/bot").status_code in (403, 404)
        assert role_client("hiring_manager").post(f"/interviews/{iv.id}/bot").status_code == 403

    def test_other_org_cannot_send_or_stop(self, other_client, iv):
        assert other_client.post(f"/interviews/{iv.id}/bot").status_code == 404
        assert other_client.delete(f"/interviews/{iv.id}/bot").status_code == 404


class TestStopBot:
    def test_stop_before_launch_cancels(self, client, db_session, org, iv):
        db_session.add(BotSession(org_id=org.id, interview_id=iv.id, status="scheduled"))
        db_session.commit()
        r = client.delete(f"/interviews/{iv.id}/bot")
        assert r.json()["status"] == "failed" and r.json()["failure_reason"] == "cancelled"

    def test_stop_in_call_flags_control_endpoint(self, client, launcher, iv):
        sid = client.post(f"/interviews/{iv.id}/bot").json()["id"]
        bot(client, sid, "POST", "events", {"type": "status", "status": "in_call"})
        assert bot(client, sid, "GET", "control").json() == {"action": "none"}
        assert client.delete(f"/interviews/{iv.id}/bot").status_code == 200
        assert bot(client, sid, "GET", "control").json() == {"action": "stop"}

    def test_stop_without_active_bot(self, client, iv):
        r = client.delete(f"/interviews/{iv.id}/bot")
        assert r.status_code == 409 and r.json()["code"] == "no_active_bot"


class TestInternalAuth:
    @pytest.fixture()
    def sid(self, client, launcher, iv):
        return client.post(f"/interviews/{iv.id}/bot").json()["id"]

    def test_unsigned_is_rejected(self, anon_client, sid):
        assert anon_client.post(f"/internal/bots/{sid}/events", json={"type": "status"}).status_code == 401
        assert anon_client.get(f"/internal/bots/{sid}/control").status_code == 401

    def test_wrong_secret_stale_timestamp_and_tampered_body(self, anon_client, sid):
        body = {"type": "status", "status": "joining"}
        assert signed(anon_client, "POST", f"/internal/bots/{sid}/events", "wrong", body).status_code == 401
        assert signed(anon_client, "POST", f"/internal/bots/{sid}/events", security.derive_bot_secret(sid), body, ts=int(time.time()) - 3600).status_code == 401
        raw = json.dumps(body).encode()
        ts = str(int(time.time()))
        sig = security.sign_body(security.derive_bot_secret(sid), raw, ts)
        tampered = anon_client.post(f"/internal/bots/{sid}/events", content=raw + b" ", headers={"X-Timestamp": ts, "X-Signature": sig})
        assert tampered.status_code == 401

    def test_one_sessions_secret_cannot_drive_another(self, anon_client, client, launcher, db_session, org, cand, sid):
        other = make_interview(db_session, org.id, cand, platform="google_meet", meeting_url=MEET, title="two")
        other_sid = client.post(f"/interviews/{other.id}/bot").json()["id"]
        r = signed(anon_client, "POST", f"/internal/bots/{other_sid}/events", security.derive_bot_secret(sid),
                   {"type": "status", "status": "in_call"})
        assert r.status_code == 401

    def test_unknown_session_looks_like_bad_signature(self, anon_client):
        r = signed(anon_client, "GET", "/internal/bots/9999/control", security.derive_bot_secret(9999))
        assert r.status_code == 401 and r.json()["code"] == "bad_signature"


class TestBotEvents:
    @pytest.fixture()
    def ctx(self, client, launcher, iv, db_session):
        sid = client.post(f"/interviews/{iv.id}/bot").json()["id"]
        return client, sid, iv

    def status_of(self, db_session, sid):
        db_session.expire_all()
        return db_session.get(BotSession, sid)

    def test_status_progression_and_interview_state(self, ctx, db_session):
        client, sid, iv = ctx
        for st in ("joining", "waiting_admission", "in_call"):
            assert bot(client, sid, "POST", "events", {"type": "status", "status": st}).status_code == 200
        s = self.status_of(db_session, sid)
        assert s.status == "in_call" and s.joined_at is not None
        assert db_session.get(Interview, iv.id).status == "in_progress"

    def test_status_never_moves_backwards(self, ctx, db_session):
        client, sid, _ = ctx
        bot(client, sid, "POST", "events", {"type": "status", "status": "in_call"})
        bot(client, sid, "POST", "events", {"type": "status", "status": "joining"})
        assert self.status_of(db_session, sid).status == "in_call"

    def test_unknown_status_and_event_rejected(self, ctx):
        client, sid, _ = ctx
        assert bot(client, sid, "POST", "events", {"type": "status", "status": "dancing"}).status_code == 422
        assert bot(client, sid, "POST", "events", {"type": "nonsense"}).status_code == 422

    def test_consent_is_logged(self, ctx, db_session):
        client, sid, _ = ctx
        assert self.status_of(db_session, sid).consent_message_sent_at is None
        bot(client, sid, "POST", "events", {"type": "consent_sent", "at": "2026-10-10T10:00:00Z"})
        s = self.status_of(db_session, sid)
        assert s.consent_message_sent_at is not None and s.consent_message

    def test_speaker_events_stored(self, ctx, db_session):
        client, sid, iv = ctx
        bot(client, sid, "POST", "events", {"type": "speaker_events", "events": [{"t_ms": 1250, "name": "Priya Sharma"}, {"t_ms": 9000, "name": "Alex"}, {"bad": 1}]})
        rows = db_session.query(SpeakerEvent).filter_by(interview_id=iv.id).order_by(SpeakerEvent.t_ms).all()
        assert [(r.t_ms, r.speaker_name) for r in rows] == [(1250, "Priya Sharma"), (9000, "Alex")]

    def test_chunks_are_org_prefixed_ordered_and_deduped(self, ctx, db_session, org):
        client, sid, _ = ctx
        for idx in (1, 0, 1):
            r = bot(client, sid, "POST", "events", {"type": "chunk_uploaded", "index": idx, "blob": f"recordings/{sid}/{idx:04d}.opus", "start_ms": idx * 30000, "duration_ms": 30000})
            assert r.status_code == 200
        chunks = self.status_of(db_session, sid).chunks
        assert [c["index"] for c in chunks] == [0, 1]
        assert chunks[0]["blob"] == f"{org.id}/recordings/{sid}/0000.opus"

    @pytest.mark.parametrize("blob", ["../../etc/passwd", "recordings/999/0001.opus", "resumes/1/x.pdf", "recordings/{sid}/a/b.opus", ""])
    def test_blob_paths_outside_the_sessions_prefix_are_rejected(self, ctx, blob):
        client, sid, _ = ctx
        r = bot(client, sid, "POST", "events", {"type": "chunk_uploaded", "index": 0, "blob": blob.replace("{sid}", str(sid)), "start_ms": 0, "duration_ms": 1})
        assert r.status_code == 422 and r.json()["code"] == "bad_blob"

    def test_completed_enqueues_pipeline_and_sets_processing(self, ctx, db_session, org):
        client, sid, iv = ctx
        with patch("app.worker.tasks.bots.process_recording_task.delay") as delay:
            r = bot(client, sid, "POST", "events", {"type": "completed", "manifest_blob": f"recordings/{sid}/manifest.json", "duration_ms": 60000})
        assert r.status_code == 200
        delay.assert_called_once_with(org.id, sid)
        s = self.status_of(db_session, sid)
        assert s.status == "completed" and s.manifest_key == f"{org.id}/recordings/{sid}/manifest.json"
        assert db_session.get(Interview, iv.id).status == "processing"

    def test_failed_without_audio_fails_interview(self, ctx, db_session):
        client, sid, iv = ctx
        bot(client, sid, "POST", "events", {"type": "failed", "reason": "admission_timeout", "detail": "nobody let me in", "screenshot_blob": f"recordings/{sid}/failure.png"})
        s = self.status_of(db_session, sid)
        assert s.status == "failed" and s.failure_reason == "admission_timeout" and s.screenshot_key.endswith("failure.png")
        db_session.expire_all()
        assert db_session.get(Interview, iv.id).status == "failed"

    def test_failed_after_recording_salvages_partial_audio(self, ctx, db_session, org):
        client, sid, iv = ctx
        bot(client, sid, "POST", "events", {"type": "chunk_uploaded", "index": 0, "blob": f"recordings/{sid}/0000.opus", "start_ms": 0, "duration_ms": 30000})
        with patch("app.worker.tasks.bots.process_recording_task.delay") as delay:
            bot(client, sid, "POST", "events", {"type": "failed", "reason": "crash", "detail": "chromium died"})
        delay.assert_called_once()
        assert self.status_of(db_session, sid).status == "failed"
        db_session.expire_all()
        assert db_session.get(Interview, iv.id).status == "processing"


class TestUploadUrl:
    @pytest.fixture()
    def sid(self, client, launcher, iv):
        return client.post(f"/interviews/{iv.id}/bot").json()["id"]

    def test_returns_presigned_put_under_org_prefix(self, s3, client, sid, org):
        r = bot(client, sid, "POST", "upload-url", {"blob": f"recordings/{sid}/0003.opus", "content_type": "audio/ogg"})
        assert r.status_code == 200
        assert f"{org.id}/recordings/{sid}/0003.opus" in r.json()["url"] and "X-Amz-Signature" in r.json()["url"]
        assert r.json()["headers"] == {"Content-Type": "audio/ogg"}

    def test_rejects_foreign_prefix_and_bad_types(self, s3, client, sid):
        assert bot(client, sid, "POST", "upload-url", {"blob": "recordings/999/x.opus", "content_type": "audio/ogg"}).json()["code"] == "bad_blob"
        assert bot(client, sid, "POST", "upload-url", {"blob": f"recordings/{sid}/x.exe", "content_type": "application/x-msdownload"}).json()["code"] == "bad_content_type"
        assert bot(client, sid, "POST", "upload-url", {"nope": 1}).status_code == 422


class TestReaper:
    def test_stuck_sessions_are_failed_and_containers_stopped(self, db_session, org, iv):
        s = BotSession(org_id=org.id, interview_id=iv.id, status="in_call", container_ref="c1")
        db_session.add(s)
        db_session.commit()
        s.updated_at = datetime.now(UTC) - timedelta(minutes=settings.bot_stuck_after_minutes + 5)
        db_session.commit()
        with patch("app.services.bot_service.get_launcher") as gl:
            assert bot_service.reap_stuck(db_session) == 1
        gl.return_value.stop.assert_called_once_with("c1")
        db_session.refresh(s)
        assert s.status == "failed" and s.failure_reason == "timeout"

    def test_fresh_sessions_are_left_alone(self, db_session, org, iv):
        db_session.add(BotSession(org_id=org.id, interview_id=iv.id, status="in_call"))
        db_session.commit()
        assert bot_service.reap_stuck(db_session) == 0
