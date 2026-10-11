"""Calendar auto-join: OAuth, sync -> interviews -> bot scheduling policy, tagging, push."""

from datetime import UTC, timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest

from app.core import crypto
from app.core.config import settings
from app.models.calendar import CalendarConnection, CalendarEvent
from app.models.interview import BotSession, Interview
from app.models.tenancy import AuditLog
from app.services import calendar_service as svc
from tests.calendar_helpers import (
    MEET, TEAMS, fake_calendar, g_event, m_event, make_connection, now,
)
from tests.factories import make_candidate, make_role


@pytest.fixture()
def fake():
    with fake_calendar() as f:
        yield f


@pytest.fixture()
def role(db_session, org):
    return make_role(db_session, org.id, "Rust Engineer")


@pytest.fixture()
def cand(db_session, org, role):
    return make_candidate(db_session, org.id, role.id, "cand@x.com", name="Cara Candidate")


def sync(db, conn, fake):
    with fake.client() as http:
        return svc.sync_connection(db, conn.id, http=http)


def events_of(db, conn):
    db.expire_all()
    return {e.external_id: e for e in db.query(CalendarEvent).filter_by(connection_id=conn.id)}


@pytest.fixture()
def launcher():
    fake = MagicMock()
    fake.launch.return_value = "container-1"
    with patch("app.services.bot_service.get_launcher", return_value=fake):
        yield fake


# ── OAuth ─────────────────────────────────────────────────────────────────────
class TestOAuth:
    def test_providers_report_configuration(self, client):
        assert {p["provider"]: p["configured"] for p in client.get("/calendar/providers").json()} == {
            "google": False, "microsoft": False}
        with fake_calendar():
            assert all(p["configured"] for p in client.get("/calendar/providers").json())

    def test_connect_requires_server_configuration(self, client):
        r = client.get("/calendar/connect/google")
        assert r.status_code == 501 and r.json()["code"] == "oauth_not_configured"
        assert client.get("/calendar/connect/github").status_code == 404

    def test_connect_url_carries_a_signed_state_for_this_user_and_org(self, client, fake, user, org):
        url = client.get("/calendar/connect/google").json()["url"]
        q = parse_qs(urlparse(url).query)
        assert q["client_id"] == ["gid"] and q["redirect_uri"][0].endswith("/calendar/oauth/google/callback")
        from app.core import security
        data = security.read_signed_token(q["state"][0], svc.STATE_SALT, 600)
        assert (data["u"], data["o"], data["p"]) == (user.id, org.id, "google")

    def _callback(self, anon_client, client, provider="google", code="abc", **over):
        url = client.get(f"/calendar/connect/{provider}").json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        return anon_client.get(f"/calendar/oauth/{provider}/callback",
                               params={"code": code, "state": over.pop("state", state), **over},
                               follow_redirects=False)

    def test_callback_stores_encrypted_tokens_and_syncs(self, anon_client, client, fake, db_session, user, cand):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        r = self._callback(anon_client, client)
        assert r.status_code == 302 and r.headers["location"].endswith("&calendar=connected")
        conn = db_session.query(CalendarConnection).one()
        assert (conn.user_id, conn.provider, conn.account_email, conn.auto_join) == (user.id, "google", "owner@gmail.com", "tagged")
        assert "at-1" not in conn.access_token_enc and crypto.decrypt(conn.access_token_enc) == "at-1"
        assert "rt-1" not in conn.refresh_token_enc and crypto.decrypt(conn.refresh_token_enc) == "rt-1"
        assert db_session.query(CalendarEvent).count() == 1  # first sync ran straight away
        assert db_session.query(AuditLog).filter_by(action="calendar.connected").count() == 1

    @pytest.mark.parametrize("params,code", [
        ({"error": "access_denied", "code": None}, "access_denied"),
        ({"state": "garbage"}, "bad_state"),
    ])
    def test_callback_failures_redirect_with_an_error_code(self, anon_client, client, fake, params, code):
        params = {k: v for k, v in params.items() if v is not None}
        if "error" in params:
            r = anon_client.get("/calendar/oauth/google/callback", params=params, follow_redirects=False)
        else:
            r = self._callback(anon_client, client, **params)
        assert r.status_code == 302 and f"calendar_error={code}" in r.headers["location"]

    def test_first_connection_without_refresh_token_is_refused(self, anon_client, client, fake, db_session):
        fake.code_gives_refresh = False
        r = self._callback(anon_client, client)
        assert "calendar_error=no_refresh_token" in r.headers["location"]
        assert db_session.query(CalendarConnection).count() == 0

    def test_reconnecting_keeps_the_existing_refresh_token_and_row(self, anon_client, client, fake, db_session):
        self._callback(anon_client, client)
        fake.code_gives_refresh = False
        self._callback(anon_client, client)
        assert db_session.query(CalendarConnection).count() == 1
        conn = db_session.query(CalendarConnection).one()
        assert crypto.decrypt(conn.refresh_token_enc) == "rt-1"

    def test_state_for_a_user_who_left_the_org_is_rejected(self, anon_client, client, fake, db_session, user, org):
        url = client.get("/calendar/connect/google").json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        from app.models.tenancy import Membership
        db_session.query(Membership).filter_by(user_id=user.id).delete()
        db_session.commit()
        r = anon_client.get("/calendar/oauth/google/callback", params={"code": "c", "state": state}, follow_redirects=False)
        assert "calendar_error=wrong_org" in r.headers["location"]

    def test_state_is_provider_bound(self, anon_client, client, fake):
        url = client.get("/calendar/connect/google").json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        r = anon_client.get("/calendar/oauth/microsoft/callback", params={"code": "c", "state": state}, follow_redirects=False)
        assert "calendar_error=bad_state" in r.headers["location"]

    def test_connections_are_personal(self, client, role_client, other_client, db_session, org, user):
        make_connection(db_session, org, user)
        assert len(client.get("/calendar/connections").json()) == 1
        rc = role_client("recruiter")
        assert rc.get("/calendar/connections").json() == []
        assert other_client.get("/calendar/connections").json() == []
        cid = client.get("/calendar/connections").json()[0]["id"]
        for c in (rc, other_client):
            assert c.patch(f"/calendar/connections/{cid}", json={"auto_join": "all"}).status_code == 404
            assert c.delete(f"/calendar/connections/{cid}").status_code == 404
            assert c.post(f"/calendar/connections/{cid}/sync").status_code == 404

    def test_connection_response_never_contains_tokens(self, client, db_session, org, user):
        make_connection(db_session, org, user)
        body = client.get("/calendar/connections").text
        assert "at-old" not in body and "rt-old" not in body and "token" not in body.replace("push_enabled", "")


# ── sync -> interviews ────────────────────────────────────────────────────────
class TestSyncCreatesInterviews:
    def test_matched_candidate_becomes_an_interview_with_participants(self, db_session, org, user, cand, fake, role_client):
        colleague = role_client("recruiter")  # make a second org member to appear as an attendee
        from app.models.tenancy import User
        peer = db_session.query(User).filter_by(email="recruiter-a@example.com").one()
        start = now() + timedelta(days=1)
        fake.google_items = [g_event("e1", "Rust screen", start, start + timedelta(minutes=45),
                                     ["cand@x.com", "recruiter-a@example.com", "outsider@other.com"])]
        conn = make_connection(db_session, org, user)

        r = sync(db_session, conn, fake)

        assert (r.seen, r.created, r.bots) == (1, 1, 0)
        iv = db_session.query(Interview).one()
        assert (iv.title, iv.platform, iv.status, iv.meeting_url) == ("Rust screen", "google_meet", "scheduled", MEET)
        assert (iv.candidate_id, iv.role_id, iv.created_by_user_id) == (cand.id, cand.role_id, user.id)
        assert iv.scheduled_start.replace(tzinfo=UTC) == start.replace(microsecond=0)
        parts = {(p.email, p.kind, p.user_id) for p in iv.participants}
        assert ("cand@x.com", "candidate", None) in parts
        assert (user.email, "interviewer", user.id) in parts
        assert ("recruiter-a@example.com", "interviewer", peer.id) in parts  # org member -> interviewer
        assert ("outsider@other.com", "other", None) in parts
        ev = events_of(db_session, conn)["e1"]
        assert (ev.candidate_id, ev.interview_id) == (cand.id, iv.id) and colleague is not None

    def test_resync_is_idempotent(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        r = sync(db_session, conn, fake)
        assert (r.created, r.updated, r.cancelled) == (0, 0, 0)
        assert db_session.query(Interview).count() == 1 and db_session.query(CalendarEvent).count() == 1

    def test_unmatched_event_is_kept_for_tagging_but_makes_no_interview(self, db_session, org, user, fake):
        fake.google_items = [g_event("e1", attendees=["stranger@x.com"])]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        ev = events_of(db_session, conn)["e1"]
        assert ev.candidate_id is None and ev.interview_id is None and ev.skip_reason == "no_candidate_match"
        assert db_session.query(Interview).count() == 0

    def test_events_without_a_link_or_all_day_are_ignored(self, db_session, org, user, cand, fake):
        fake.google_items = [
            g_event("nolink", attendees=["cand@x.com"], link=None),
            {"id": "allday", "summary": "Holiday", "start": {"date": "2026-10-20"}, "end": {"date": "2026-10-21"}, "hangoutLink": MEET},
        ]
        conn = make_connection(db_session, org, user)
        r = sync(db_session, conn, fake)
        assert r.seen == 0 and db_session.query(CalendarEvent).count() == 0

    def test_candidate_matching_is_case_insensitive_and_org_scoped(self, db_session, org, other_org, user, cand, fake):
        theirs = make_candidate(db_session, other_org.id, make_role(db_session, other_org.id, "R").id, "foreign@x.com")
        fake.google_items = [
            g_event("e1", attendees=["CAND@X.COM"]),
            g_event("e2", attendees=[theirs.email]),
        ]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        evs = events_of(db_session, conn)
        assert evs["e1"].candidate_id == cand.id
        assert evs["e2"].candidate_id is None  # another org's candidate must never match

    def test_the_owner_is_never_treated_as_the_candidate(self, db_session, org, role, user, fake):
        make_candidate(db_session, org.id, role.id, "owner@gmail.com", name="Same Address")
        fake.google_items = [g_event("e1")]  # only attendee is the owner themself
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        assert events_of(db_session, conn)["e1"].candidate_id is None

    def test_microsoft_events_sync_too(self, db_session, org, user, cand, fake):
        fake.ms_items = [m_event("m1", "Panel", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user, provider="microsoft")
        sync(db_session, conn, fake)
        iv = db_session.query(Interview).one()
        assert iv.platform == "teams" and iv.meeting_url == TEAMS

    def test_declined_by_the_owner_creates_nothing(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], self_response="declined")]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        assert db_session.query(Interview).count() == 0
        assert events_of(db_session, conn)["e1"].cancelled is True

    def test_interviews_show_up_in_the_api_for_the_owner(self, client, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", "Visible", attendees=["cand@x.com"])]
        sync(db_session, make_connection(db_session, org, user), fake)
        assert [i["title"] for i in client.get("/interviews").json()] == ["Visible"]


# ── bot scheduling policy ─────────────────────────────────────────────────────
class TestAutoJoinPolicy:
    def _setup(self, db, org, user, fake, mode, **ev):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], **ev)]
        return make_connection(db, org, user, auto_join=mode)

    def test_all_schedules_the_bot_one_minute_before_start(self, db_session, org, user, cand, fake, launcher):
        start = now() + timedelta(hours=3)
        conn = self._setup(db_session, org, user, fake, "all", start=start)
        r = sync(db_session, conn, fake)
        assert (r.created, r.bots) == (1, 1)
        s = db_session.query(BotSession).one()
        assert s.status == "scheduled"
        assert abs((s.launch_at.replace(tzinfo=UTC) - (start - timedelta(minutes=1))).total_seconds()) < 2
        launcher.launch.assert_not_called()  # nothing launches until the beat sweep reaches launch_at
        assert events_of(db_session, conn)["e1"].skip_reason is None

    def test_meeting_already_in_progress_launches_immediately(self, db_session, org, user, cand, fake, launcher):
        start = now() - timedelta(minutes=5)
        conn = self._setup(db_session, org, user, fake, "all", start=start, end=start + timedelta(minutes=45))
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).one().status == "launching"
        launcher.launch.assert_called_once()

    def test_finished_meetings_never_get_a_bot(self, db_session, org, user, cand, fake, launcher):
        start = now() - timedelta(hours=3)
        conn = self._setup(db_session, org, user, fake, "all", start=start, end=start + timedelta(hours=1))
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).count() == 0
        assert events_of(db_session, conn)["e1"].skip_reason == "event_in_past"

    @pytest.mark.parametrize("mode,reason", [("tagged", "not_tagged"), ("never", "auto_join_off")])
    def test_other_modes_create_the_interview_without_a_bot(self, db_session, org, user, cand, fake, mode, reason):
        conn = self._setup(db_session, org, user, fake, mode)
        r = sync(db_session, conn, fake)
        assert (r.created, r.bots) == (1, 0)
        assert db_session.query(BotSession).count() == 0
        assert events_of(db_session, conn)["e1"].skip_reason == reason

    def test_teams_gets_the_bot_but_zoom_is_created_without_one(self, db_session, org, user, cand, fake, launcher):
        fake.google_items = [g_event("t", attendees=["cand@x.com"], link=TEAMS),
                             g_event("z", attendees=["cand@x.com"], link="https://a.zoom.us/j/12345")]
        conn = make_connection(db_session, org, user, auto_join="all")
        sync(db_session, conn, fake)
        assert db_session.query(Interview).count() == 2
        evs = events_of(db_session, conn)
        teams_iv = db_session.get(Interview, evs["t"].interview_id)
        assert teams_iv.platform == "teams" and len(teams_iv.bot_sessions) == 1 and evs["t"].skip_reason is None
        zoom_iv = db_session.get(Interview, evs["z"].interview_id)
        assert zoom_iv.platform == "zoom" and zoom_iv.bot_sessions == []
        assert evs["z"].skip_reason == "platform_unsupported"

    def test_interviewer_role_owners_cannot_auto_schedule_bots(self, db_session, org, cand, fake, role_client):
        from app.models.tenancy import User
        role_client("interviewer")
        iv_user = db_session.query(User).filter_by(email="interviewer-a@example.com").one()
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, iv_user, auto_join="all")
        sync(db_session, conn, fake)
        assert db_session.query(Interview).count() == 1 and db_session.query(BotSession).count() == 0
        assert events_of(db_session, conn)["e1"].skip_reason == "role_cannot_schedule_bot"

    def test_a_failed_bot_is_not_retried_automatically(self, db_session, org, user, cand, fake, launcher):
        conn = self._setup(db_session, org, user, fake, "all")
        sync(db_session, conn, fake)
        s = db_session.query(BotSession).one()
        s.status, s.failure_reason = "failed", "admission_timeout"
        db_session.commit()
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).count() == 1
        assert events_of(db_session, conn)["e1"].skip_reason == "bot_already_attempted"

    def test_an_active_bot_is_not_duplicated(self, db_session, org, user, cand, fake, launcher):
        conn = self._setup(db_session, org, user, fake, "all")
        sync(db_session, conn, fake)
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).count() == 1

    def test_changing_the_setting_applies_on_the_next_sync(self, client, db_session, org, user, cand, fake):
        conn = self._setup(db_session, org, user, fake, "tagged")
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).count() == 0
        assert client.patch(f"/calendar/connections/{conn.id}", json={"auto_join": "all"}).json()["auto_join"] == "all"
        db_session.expire_all()  # the API changed it in its own session
        sync(db_session, conn, fake)
        assert db_session.query(BotSession).count() == 1

    def test_auto_join_value_is_validated(self, client, db_session, org, user):
        conn = make_connection(db_session, org, user)
        assert client.patch(f"/calendar/connections/{conn.id}", json={"auto_join": "sometimes"}).status_code == 422


# ── tagging ───────────────────────────────────────────────────────────────────
class TestTagging:
    @pytest.fixture()
    def synced(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", "Unknown attendee", attendees=["stranger@x.com"])]
        conn = make_connection(db_session, org, user, auto_join="tagged")
        sync(db_session, conn, fake)
        return conn, events_of(db_session, conn)["e1"]

    def test_tagging_with_a_candidate_creates_the_interview_and_schedules_the_bot(self, client, synced, cand, db_session):
        conn, ev = synced
        r = client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True, "candidate_id": cand.id})
        assert r.status_code == 200
        body = r.json()
        assert body["tagged"] is True and body["candidate"]["name"] == cand.name
        assert body["interview_id"] and body["bot_status"] == "scheduled" and body["skip_reason"] is None
        assert db_session.query(BotSession).count() == 1

    def test_tag_needs_a_candidate_when_none_matched(self, client, synced):
        _, ev = synced
        r = client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True})
        assert r.status_code == 422 and r.json()["code"] == "candidate_required"

    def test_tag_rejects_unknown_and_foreign_candidates(self, client, synced, db_session, other_org):
        _, ev = synced
        theirs = make_candidate(db_session, other_org.id, make_role(db_session, other_org.id, "R").id, "z@x.com")
        assert client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True, "candidate_id": 9999}).status_code == 404
        assert client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True, "candidate_id": theirs.id}).status_code == 404

    def test_a_matched_event_can_be_tagged_without_choosing(self, client, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user, auto_join="tagged")
        sync(db_session, conn, fake)
        ev = events_of(db_session, conn)["e1"]
        assert client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True}).json()["bot_status"] == "scheduled"

    def test_the_tagged_candidate_survives_later_syncs(self, client, synced, cand, db_session, fake):
        conn, ev = synced
        client.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True, "candidate_id": cand.id})
        sync(db_session, conn, fake)  # provider still says the only attendee is a stranger
        again = events_of(db_session, conn)["e1"]
        assert again.candidate_id == cand.id and db_session.query(Interview).count() == 1

    def test_events_are_only_taggable_by_their_owner(self, role_client, other_client, synced):
        _, ev = synced
        for c in (role_client("recruiter"), other_client):
            assert c.post(f"/calendar/events/{ev.id}/tag", json={"tagged": True}).status_code == 404

    def test_event_list_is_personal_and_upcoming_only(self, client, role_client, db_session, org, user, cand, fake):
        fake.google_items = [g_event("soon", attendees=["cand@x.com"]),
                             g_event("old", attendees=["cand@x.com"], start=now() - timedelta(days=2))]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        db_session.query(CalendarEvent).filter_by(external_id="old").update({"start": now() - timedelta(days=2)})
        db_session.commit()
        assert [e["title"] for e in client.get("/calendar/events").json()] == ["Interview"]
        assert role_client("recruiter").get("/calendar/events").json() == []
        assert client.get(f"/calendar/events?connection_id={conn.id}").status_code == 200


# ── changes and cancellations ─────────────────────────────────────────────────
class TestChangesAndCancellations:
    def test_cancelled_event_cancels_the_interview_and_its_pending_bot(self, db_session, org, user, cand, fake, launcher):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user, auto_join="all")
        sync(db_session, conn, fake)
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], status="cancelled")]
        r = sync(db_session, conn, fake)
        assert r.cancelled == 1
        db_session.expire_all()
        assert db_session.query(Interview).one().status == "cancelled"
        s = db_session.query(BotSession).one()
        assert (s.status, s.failure_reason) == ("failed", "cancelled")

    def test_event_deleted_in_the_provider_is_treated_as_cancelled(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        fake.google_items = []
        assert sync(db_session, conn, fake).cancelled == 1
        db_session.expire_all()
        assert db_session.query(Interview).one().status == "cancelled"

    def test_rescheduled_event_moves_the_interview_and_the_bot(self, db_session, org, user, cand, fake):
        t1, t2 = now() + timedelta(hours=3), now() + timedelta(hours=8)
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], start=t1)]
        conn = make_connection(db_session, org, user, auto_join="all")
        sync(db_session, conn, fake)
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], start=t2)]
        assert sync(db_session, conn, fake).updated == 1
        db_session.expire_all()
        iv = db_session.query(Interview).one()
        assert iv.scheduled_start.replace(tzinfo=UTC) == t2.replace(microsecond=0)
        s = db_session.query(BotSession).one()
        assert abs((s.launch_at.replace(tzinfo=UTC) - (t2 - timedelta(minutes=1))).total_seconds()) < 2

    def test_interviews_that_already_ran_are_not_touched(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        iv = db_session.query(Interview).one()
        iv.status = "completed"
        db_session.commit()
        fake.google_items = [g_event("e1", attendees=["cand@x.com"], status="cancelled")]
        sync(db_session, conn, fake)
        db_session.expire_all()
        assert db_session.query(Interview).one().status == "completed"

    def test_disconnect_cancels_pending_bots_but_keeps_interviews(self, client, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user, auto_join="all")
        sync(db_session, conn, fake)
        with fake_calendar(fake):
            assert client.delete(f"/calendar/connections/{conn.id}").status_code == 204
        db_session.expire_all()
        assert db_session.query(CalendarConnection).count() == 0 and db_session.query(CalendarEvent).count() == 0
        assert db_session.query(Interview).count() == 1  # history stays
        assert db_session.query(BotSession).one().failure_reason == "cancelled"
        assert fake.count("POST", "/revoke") == 1  # access revoked at Google too
        assert db_session.query(AuditLog).filter_by(action="calendar.disconnected").count() == 1


# ── tokens and failures ───────────────────────────────────────────────────────
class TestTokensAndFailures:
    def test_expired_access_token_is_refreshed_and_stored_encrypted(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user, expires_in=timedelta(seconds=-10))
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert fake.count("POST", "/token") == 1
        assert crypto.decrypt(conn.access_token_enc) == "at-refreshed" and "at-refreshed" not in conn.access_token_enc
        assert (fake.requests[-1].headers["authorization"]) == "Bearer at-refreshed"

    def test_a_valid_token_is_not_refreshed(self, db_session, org, user, fake):
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        assert fake.count("POST", "/token") == 0 and fake.requests[0].headers["authorization"] == "Bearer at-old"

    def test_revoked_access_marks_needs_reauth_emails_once_and_stops_syncing(self, db_session, org, user, fake):
        from app.core import email as mailer
        fake.refresh_fails = True
        conn = make_connection(db_session, org, user, expires_in=timedelta(seconds=-10))
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.status == "needs_reauth" and "revoked" in conn.last_error
        assert [m["to"] for m in mailer.outbox if "Reconnect" in m["subject"]] == [user.email]
        calls = len(fake.calls)
        sync(db_session, conn, fake)  # skipped entirely until the user reconnects
        assert len(fake.calls) == calls and len([m for m in mailer.outbox if "Reconnect" in m["subject"]]) == 1

    def test_provider_rejecting_the_token_also_needs_reauth(self, db_session, org, user, fake):
        fake.events_status = 401
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.status == "needs_reauth"

    def test_transient_errors_are_recorded_but_do_not_disconnect_or_lose_data(self, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        fake.events_status = 503
        r = sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert r.seen == 0 and conn.status == "active" and "503" in conn.last_error
        assert db_session.query(Interview).one().status == "scheduled"  # nothing cancelled by an outage
        fake.events_status = 200
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.last_error is None and conn.last_synced_at is not None

    def test_a_key_change_is_handled_as_reauth_not_a_crash(self, db_session, org, user, fake):
        conn = make_connection(db_session, org, user)
        conn.access_token_enc = "not-a-valid-fernet-token"
        conn.token_expires_at = now() + timedelta(hours=1)
        db_session.commit()
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.status == "needs_reauth"

    def test_owner_who_left_the_org_is_flagged(self, db_session, org, user, fake):
        from app.models.tenancy import Membership
        conn = make_connection(db_session, org, user)
        db_session.query(Membership).filter_by(user_id=user.id).delete()
        db_session.commit()
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.status == "error" and "no longer a member" in conn.last_error

    def test_sync_now_endpoint_runs_a_sync(self, client, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        conn = make_connection(db_session, org, user)
        r = client.post(f"/calendar/connections/{conn.id}/sync")
        assert r.status_code == 202 and db_session.query(CalendarEvent).count() == 1

    def test_sync_all_only_touches_active_connections(self, db_session, org, user, other_org, other_user):
        a = make_connection(db_session, org, user)
        make_connection(db_session, org, user, provider="microsoft", status="needs_reauth")
        b = make_connection(db_session, other_org, other_user)
        assert sorted(svc.due_connection_ids(db_session)) == sorted([a.id, b.id])
        from app.worker.celery_app import celery_app
        sched = celery_app.conf.beat_schedule
        assert sched["calendar-sync"]["task"] == "calendar.sync_all"
        assert sched["calendar-sync"]["schedule"] == settings.calendar_sync_minutes * 60


# ── push notifications ────────────────────────────────────────────────────────
@pytest.fixture()
def public_api():
    with patch.object(settings, "public_api_url", "https://api.example.com"):
        yield


class TestPush:
    def test_not_attempted_for_local_or_plain_http_urls(self):
        for url in ("http://localhost:8000", "http://api.example.com", "https://localhost"):
            with patch.object(settings, "public_api_url", url):
                assert svc.push_possible() is False
        with patch.object(settings, "public_api_url", "https://api.example.com"), patch.object(
            settings, "calendar_push_enabled", False
        ):
            assert svc.push_possible() is False

    def test_sync_registers_a_google_channel_when_public(self, public_api, db_session, org, user, fake):
        conn = make_connection(db_session, org, user)
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.watch_id and conn.watch_resource == "res-1" and conn.watch_expires_at
        import json
        sent = json.loads([r for r in fake.requests if r.url.path.endswith("/events/watch")][0].content)
        assert sent["address"] == "https://api.example.com/webhooks/calendar/google"
        assert sent["token"] == svc.watch_secret(conn.id)

    def test_a_healthy_watch_is_left_alone_and_an_expiring_one_is_replaced(self, public_api, db_session, org, user, fake):
        conn = make_connection(db_session, org, user, watch_id="chan-1", watch_resource="res-0",
                               watch_expires_at=now() + timedelta(days=3))
        sync(db_session, conn, fake)
        assert fake.count("POST", "/events/watch") == 0
        conn.watch_expires_at = now() + timedelta(hours=2)
        db_session.commit()
        sync(db_session, conn, fake)
        assert fake.count("POST", "/channels/stop") == 1 and fake.count("POST", "/events/watch") == 1
        db_session.refresh(conn)
        assert conn.watch_id != "chan-1"

    def test_microsoft_subscription_is_created_then_renewed(self, public_api, db_session, org, user, fake):
        conn = make_connection(db_session, org, user, provider="microsoft")
        sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert conn.watch_id == "sub-1"
        conn.watch_expires_at = now() + timedelta(hours=1)
        db_session.commit()
        assert svc.renew_due_watches(db_session, http=fake.client()) == 1
        assert fake.count("PATCH", "/v1.0/subscriptions/sub-1") == 1

    def test_a_watch_failure_never_breaks_the_sync(self, public_api, db_session, org, user, cand, fake):
        fake.google_items = [g_event("e1", attendees=["cand@x.com"])]
        orig = fake.handler

        def failing(request):
            if request.url.path.endswith("/events/watch"):
                import httpx
                return httpx.Response(500, text="no")
            return orig(request)

        fake.handler = failing
        conn = make_connection(db_session, org, user)
        r = sync(db_session, conn, fake)
        db_session.refresh(conn)
        assert r.created == 1 and conn.status == "active" and conn.watch_id is None

    def test_google_webhook_triggers_a_sync_only_with_the_right_secret(self, anon_client, db_session, org, user):
        conn = make_connection(db_session, org, user, watch_id="chan-9")
        good = {"X-Goog-Channel-ID": "chan-9", "X-Goog-Channel-Token": svc.watch_secret(conn.id),
                "X-Goog-Resource-State": "exists"}
        with patch("app.worker.tasks.calendar.sync_connection_task.delay") as delay:
            assert anon_client.post("/webhooks/calendar/google", headers=good).status_code == 204
            delay.assert_called_once_with(conn.id)
            delay.reset_mock()
            assert anon_client.post("/webhooks/calendar/google", headers={**good, "X-Goog-Channel-Token": "nope"}).status_code == 204
            assert anon_client.post("/webhooks/calendar/google", headers={**good, "X-Goog-Channel-ID": "other"}).status_code == 204
            assert anon_client.post("/webhooks/calendar/google", headers={**good, "X-Goog-Resource-State": "sync"}).status_code == 204
            delay.assert_not_called()  # wrong secret / unknown channel / initial handshake

    def test_microsoft_handshake_echoes_the_token_and_notifications_are_verified(self, anon_client, db_session, org, user):
        conn = make_connection(db_session, org, user, provider="microsoft", watch_id="sub-7")
        r = anon_client.post("/webhooks/calendar/microsoft?validationToken=abc%20123")
        assert r.status_code == 200 and r.text == "abc 123" and r.headers["content-type"].startswith("text/plain")
        ok = {"subscriptionId": "sub-7", "clientState": svc.watch_secret(conn.id)}
        bad = {"subscriptionId": "sub-7", "clientState": "forged"}
        with patch("app.worker.tasks.calendar.sync_connection_task.delay") as delay:
            assert anon_client.post("/webhooks/calendar/microsoft", json={"value": [bad]}).status_code == 202
            delay.assert_not_called()
            assert anon_client.post("/webhooks/calendar/microsoft", json={"value": [ok, ok, ok]}).status_code == 202
            delay.assert_called_once_with(conn.id)  # burst of notifications -> one sync
            assert anon_client.post("/webhooks/calendar/microsoft", content=b"not json").status_code == 202


def test_stored_tokens_use_the_configured_fernet_key(monkeypatch):
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "token_encryption_key", key)
    crypto._fernet.cache_clear()
    try:
        token = crypto.encrypt("secret-value")
        assert Fernet(key.encode()).decrypt(token.encode()) == b"secret-value"
        monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode())
        crypto._fernet.cache_clear()
        with pytest.raises(crypto.DecryptionError):
            crypto.decrypt(token)
    finally:
        monkeypatch.undo()
        crypto._fernet.cache_clear()
