"""A fake Google/Microsoft served over httpx.MockTransport, plus builders for events/connections."""

import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx

from app.core import crypto
from app.core.config import settings
from app.models.calendar import CalendarConnection

MEET = "https://meet.google.com/abc-defg-hij"
TEAMS = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0"


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def now() -> datetime:
    return datetime.now(UTC)


def g_event(id_, title="Interview", start=None, end=None, attendees=(), link=MEET,
            status="confirmed", self_response="accepted", organizer="owner@gmail.com", **extra):
    start = start or now() + timedelta(hours=2)
    end = end or start + timedelta(hours=1)
    att = [{"email": "owner@gmail.com", "self": True, "responseStatus": self_response}]
    att += [{"email": e, "displayName": e.split("@")[0].title(), "responseStatus": "accepted"} for e in attendees]
    ev = {
        "id": id_, "summary": title, "status": status, "etag": f'"{id_}-{iso(start)}"',
        "start": {"dateTime": iso(start)}, "end": {"dateTime": iso(end)},
        "attendees": att, "organizer": {"email": organizer},
    }
    if link:
        ev["hangoutLink"] = link
    ev.update(extra)
    return ev


def m_event(id_, title="Interview", start=None, end=None, attendees=(), join_url=TEAMS,
            cancelled=False, body_link=None):
    start = start or now() + timedelta(hours=2)
    end = end or start + timedelta(hours=1)
    ev = {
        "id": id_, "subject": title, "isCancelled": cancelled, "isAllDay": False,
        "changeKey": f"ck-{id_}-{iso(start)}",
        "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"},
        "attendees": [{"emailAddress": {"address": e, "name": e.split("@")[0]}, "type": "required",
                       "status": {"response": "accepted"}} for e in attendees],
        "organizer": {"emailAddress": {"address": "owner@outlook.com"}},
        "bodyPreview": body_link or "",
    }
    if join_url:
        ev["onlineMeeting"] = {"joinUrl": join_url}
    return ev


class FakeProviders:
    """Records every call; tests mutate `google_items` / `ms_items` / failure switches."""

    def __init__(self):
        self.google_items: list[dict] = []
        self.ms_items: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.requests: list[httpx.Request] = []
        self.google_email = "owner@gmail.com"
        self.ms_email = "owner@outlook.com"
        self.code_gives_refresh = True
        self.refresh_fails = False
        self.events_status = 200
        self.events_pages: list[list[dict]] | None = None  # google pagination

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        host, path = url.netloc, url.path
        self.calls.append((request.method, f"{host}{path}"))
        self.requests.append(request)
        form = parse_qs(request.content.decode()) if request.content and request.method == "POST" and \
            request.headers.get("content-type", "").startswith("application/x-www-form") else {}

        if host == "oauth2.googleapis.com" and path == "/token" or host == "login.microsoftonline.com" and path.endswith("/token"):
            grant = form.get("grant_type", [""])[0]
            if grant == "refresh_token":
                if self.refresh_fails:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(200, json={"access_token": "at-refreshed", "expires_in": 3600})
            body = {"access_token": "at-1", "expires_in": 3600, "scope": "calendar"}
            if self.code_gives_refresh:
                body["refresh_token"] = "rt-1"
            return httpx.Response(200, json=body)
        if host == "openidconnect.googleapis.com":
            return httpx.Response(200, json={"email": self.google_email})
        if host == "graph.microsoft.com" and path == "/v1.0/me":
            return httpx.Response(200, json={"mail": self.ms_email})
        if host == "oauth2.googleapis.com" and path == "/revoke":
            return httpx.Response(200, json={})
        if host == "www.googleapis.com" and path.endswith("/events/watch"):
            return httpx.Response(200, json={"resourceId": "res-1", "expiration": str(int((now() + timedelta(days=6)).timestamp() * 1000))})
        if host == "www.googleapis.com" and path.endswith("/channels/stop"):
            return httpx.Response(204)
        if host == "graph.microsoft.com" and path == "/v1.0/subscriptions" and request.method == "POST":
            return httpx.Response(201, json={"id": "sub-1"})
        if host == "graph.microsoft.com" and path.startswith("/v1.0/subscriptions/"):
            return httpx.Response(200, json={}) if request.method == "PATCH" else httpx.Response(204)
        if host == "www.googleapis.com" and path.endswith("/calendars/primary/events"):
            if self.events_status != 200:
                return httpx.Response(self.events_status, text="boom")
            if self.events_pages is not None:
                page = int(parse_qs(url.query).get("pageToken", ["0"])[0])
                body = {"items": self.events_pages[page]}
                if page + 1 < len(self.events_pages):
                    body["nextPageToken"] = str(page + 1)
                return httpx.Response(200, json=body)
            return httpx.Response(200, json={"items": self.google_items})
        if host == "graph.microsoft.com" and path == "/v1.0/me/calendarView":
            if self.events_status != 200:
                return httpx.Response(self.events_status, text="boom")
            return httpx.Response(200, json={"value": self.ms_items})
        return httpx.Response(404, text=f"unexpected {request.method} {host}{path}")

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def count(self, method: str, suffix: str) -> int:
        return sum(1 for m, u in self.calls if m == method and u.endswith(suffix))


@contextmanager
def fake_calendar(fake: FakeProviders | None = None):
    fake = fake or FakeProviders()
    with patch("app.services.calendar_service.http_client", side_effect=fake.client), patch.object(
        settings, "google_client_id", "gid"
    ), patch.object(settings, "google_client_secret", "gsecret"), patch.object(
        settings, "microsoft_client_id", "mid"
    ), patch.object(settings, "microsoft_client_secret", "msecret"):
        yield fake


def make_connection(db, org, user, provider="google", auto_join="tagged", email=None,
                    expires_in=timedelta(hours=1), **kw) -> CalendarConnection:
    conn = CalendarConnection(
        org_id=org.id, user_id=user.id, provider=provider,
        account_email=email or ("owner@gmail.com" if provider == "google" else "owner@outlook.com"),
        access_token_enc=crypto.encrypt("at-old"), refresh_token_enc=crypto.encrypt("rt-old"),
        token_expires_at=now() + expires_in, auto_join=auto_join, status=kw.pop("status", "active"), **kw,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


def dump(obj) -> str:
    return json.dumps(obj, default=str)
