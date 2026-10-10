"""Meeting-link extraction and the Google / Microsoft adapters against a fake provider."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import settings
from app.services.calendar import google, microsoft
from app.services.calendar.links import extract_meeting_url
from app.services.calendar.types import CalendarApiError, CalendarAuthError
from tests.calendar_helpers import (
    MEET, TEAMS, FakeProviders, fake_calendar, g_event, iso, m_event, now,
)


class TestLinks:
    @pytest.mark.parametrize("text,expected", [
        ("Join: https://meet.google.com/abc-defg-hij.", MEET),
        ("<a href='https://meet.google.com/abc-defg-hij?authuser=0'>join</a>", MEET + "?authuser=0"),
        ("see https://teams.microsoft.com/l/meetup-join/xyz%40thread.v2/0?context=1)", "https://teams.microsoft.com/l/meetup-join/xyz%40thread.v2/0?context=1"),
        ("https://acme.zoom.us/j/123456789?pwd=abc, thanks", "https://acme.zoom.us/j/123456789?pwd=abc"),
        ("https://us02web.zoom.us/my/room", "https://us02web.zoom.us/my/room"),
        ("&lt;https://meet.google.com/abc-defg-hij&gt;", MEET),
    ])
    def test_supported_links(self, text, expected):
        assert extract_meeting_url(text) == expected

    @pytest.mark.parametrize("text", [
        None, "", "no link here", "https://example.com/call", "https://meet.google.com/lookup/xyz",
        "https://notmeet.google.com.evil.io/abc-defg-hij",
    ])
    def test_unsupported_or_lookalike_links(self, text):
        assert extract_meeting_url(text) is None

    def test_first_field_wins(self):
        assert extract_meeting_url(None, MEET, TEAMS) == MEET


class TestGoogleParse:
    def test_hangout_link_attendees_and_times(self):
        start = now() + timedelta(days=1)
        ev = google._parse(g_event("e1", "Tech round", start, start + timedelta(hours=1), ["cand@x.com"]))
        assert ev.meeting_url == MEET and ev.title == "Tech round" and not ev.cancelled
        assert ev.start == start.replace(microsecond=0) and ev.start.tzinfo is not None
        assert [(a.email, a.is_self) for a in ev.attendees] == [("owner@gmail.com", True), ("cand@x.com", False)]
        assert ev.version

    def test_conference_data_description_and_location_fallbacks(self):
        item = g_event("e2", link=None, conferenceData={"entryPoints": [
            {"entryPointType": "phone", "uri": "tel:+1"}, {"entryPointType": "video", "uri": MEET}]})
        assert google._parse(item).meeting_url == MEET
        assert google._parse(g_event("e3", link=None, description=f"<p>Join {MEET}</p>")).meeting_url == MEET
        assert google._parse(g_event("e4", link=None, location="https://x.zoom.us/j/99")).meeting_url == "https://x.zoom.us/j/99"
        assert google._parse(g_event("e5", link=None)).meeting_url is None

    def test_all_day_cancelled_rooms_and_offsets(self):
        assert google._parse({"id": "a", "start": {"date": "2026-10-12"}, "end": {"date": "2026-10-13"}}).all_day is True
        assert google._parse(g_event("c", status="cancelled")).cancelled is True
        room = g_event("r", attendees=["cand@x.com"])
        room["attendees"].append({"email": "room@resource.calendar.google.com", "resource": True})
        assert [a.email for a in google._parse(room).attendees] == ["owner@gmail.com", "cand@x.com"]
        off = g_event("o")
        off["start"] = {"dateTime": "2026-10-12T10:00:00+05:30"}
        assert google._parse(off).start == datetime(2026, 10, 12, 4, 30, tzinfo=UTC)

    def test_event_without_start_is_ignored(self):
        assert google._parse({"id": "x"}) is None


class TestGoogleApi:
    def test_list_paginates_and_requests_deleted_single_events(self):
        fake = FakeProviders()
        fake.events_pages = [[g_event("a")], [g_event("b")], [g_event("c")]]
        with fake_calendar(fake), fake.client() as http:
            evs = google.list_events(http, "tok", now(), now() + timedelta(days=14))
        assert [e.external_id for e in evs] == ["a", "b", "c"]
        q = parse_qs(urlparse(str(fake.requests[0].url)).query)
        assert q["singleEvents"] == ["true"] and q["showDeleted"] == ["true"] and q["orderBy"] == ["startTime"]
        assert fake.requests[0].headers["authorization"] == "Bearer tok"

    @pytest.mark.parametrize("status,exc", [(401, CalendarAuthError), (500, CalendarApiError), (429, CalendarApiError)])
    def test_error_mapping(self, status, exc):
        fake = FakeProviders()
        fake.events_status = status
        with fake_calendar(fake), fake.client() as http, pytest.raises(exc):
            google.list_events(http, "tok", now(), now() + timedelta(days=1))

    def test_refresh_keeps_old_refresh_token_and_maps_invalid_grant(self):
        fake = FakeProviders()
        with fake_calendar(fake), fake.client() as http:
            ts = google.refresh(http, "rt-keep")
            assert ts.access_token == "at-refreshed" and ts.refresh_token == "rt-keep"
            assert ts.expires_at > datetime.now(UTC)
            fake.refresh_fails = True
            with pytest.raises(CalendarAuthError):
                google.refresh(http, "rt-keep")

    def test_authorize_url_requests_offline_read_only_access(self):
        with fake_calendar():
            q = parse_qs(urlparse(google.authorize_url("https://api/cb", "STATE", "me@x.com")).query)
        assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"] and q["state"] == ["STATE"]
        assert "calendar.events.readonly" in q["scope"][0] and "calendar.events " not in q["scope"][0] + " "
        assert q["login_hint"] == ["me@x.com"] and q["redirect_uri"] == ["https://api/cb"]

    def test_exchange_code_reads_account_email(self):
        fake = FakeProviders()
        with fake_calendar(fake), fake.client() as http:
            ts = google.exchange_code(http, "code", "https://api/cb")
        assert ts.account_email == "owner@gmail.com" and ts.refresh_token == "rt-1"

    def test_create_watch_sends_channel_address_and_token(self):
        fake = FakeProviders()
        with fake_calendar(fake), fake.client() as http:
            info = google.create_watch(http, "tok", "https://api/webhooks/calendar/google", "secret")
        sent = [r for r in fake.requests if r.url.path.endswith("/events/watch")][0]
        import json
        body = json.loads(sent.content)
        assert body["type"] == "web_hook" and body["address"].endswith("/webhooks/calendar/google") and body["token"] == "secret"
        assert info.resource == "res-1" and info.expires_at > datetime.now(UTC)


class TestMicrosoftParse:
    def test_join_url_attendees_and_seven_digit_fractions(self):
        start = now() + timedelta(days=1)
        ev = microsoft._parse(m_event("m1", "Panel", start, attendees=["cand@x.com"]))
        assert ev.meeting_url == TEAMS and ev.start == start.replace(microsecond=0)
        assert [a.email for a in ev.attendees] == ["cand@x.com"] and ev.version.startswith("ck-m1")

    def test_body_link_fallback_cancelled_and_resources(self):
        assert microsoft._parse(m_event("m2", join_url=None, body_link=f"Join {MEET}")).meeting_url == MEET
        assert microsoft._parse(m_event("m3", cancelled=True)).cancelled is True
        item = m_event("m4", attendees=["cand@x.com"])
        item["attendees"].append({"emailAddress": {"address": "room@x.com"}, "type": "resource"})
        assert [a.email for a in microsoft._parse(item).attendees] == ["cand@x.com"]
        assert microsoft._parse({"id": "n"}) is None


class TestMicrosoftApi:
    def test_list_requests_utc_and_maps_errors(self):
        fake = FakeProviders()
        fake.ms_items = [m_event("a"), m_event("b")]
        with fake_calendar(fake), fake.client() as http:
            evs = microsoft.list_events(http, "tok", now(), now() + timedelta(days=14))
        assert [e.external_id for e in evs] == ["a", "b"]
        assert fake.requests[0].headers["prefer"] == 'outlook.timezone="UTC"'
        for status, exc in ((401, CalendarAuthError), (503, CalendarApiError)):
            fake.events_status = status
            with fake_calendar(fake), fake.client() as http, pytest.raises(exc):
                microsoft.list_events(http, "tok", now(), now() + timedelta(days=1))

    def test_refresh_invalid_grant_and_subscription_lifecycle(self):
        fake = FakeProviders()
        with fake_calendar(fake), fake.client() as http:
            assert microsoft.refresh(http, "rt").access_token == "at-refreshed"
            info = microsoft.create_watch(http, "tok", "https://api/webhooks/calendar/microsoft", "secret")
            assert info.watch_id == "sub-1" and info.expires_at > datetime.now(UTC) + timedelta(days=2)
            assert microsoft.renew_watch(http, "tok", "sub-1").watch_id == "sub-1"
            microsoft.stop_watch(http, "tok", "sub-1", None)
            fake.refresh_fails = True
            with pytest.raises(CalendarAuthError):
                microsoft.refresh(http, "rt")
        assert fake.count("POST", "/v1.0/subscriptions") == 1 and fake.count("DELETE", "/v1.0/subscriptions/sub-1") == 1

    def test_authorize_url_asks_for_offline_calendar_read(self):
        with fake_calendar():
            q = parse_qs(urlparse(microsoft.authorize_url("https://api/cb", "S")).query)
        assert "offline_access" in q["scope"][0] and "Calendars.Read" in q["scope"][0]
        assert "ReadWrite" not in q["scope"][0] and q["client_id"] == ["mid"]


def test_unconfigured_providers_report_false(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    monkeypatch.setattr(settings, "microsoft_client_secret", "")
    assert google.configured() is False and microsoft.configured() is False
    assert iso(datetime(2026, 1, 1, tzinfo=UTC)) == "2026-01-01T00:00:00Z"
