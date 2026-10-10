"""Google Calendar adapter (OAuth + events + push channels). Plain HTTPS, no vendor SDK."""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.services.calendar.links import extract_meeting_url
from app.services.calendar.types import (
    Attendee,
    CalendarApiError,
    CalendarAuthError,
    RawEvent,
    TokenSet,
    WatchInfo,
)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = "openid email https://www.googleapis.com/auth/calendar.events.readonly"
name = "google"


def configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def authorize_url(redirect_uri: str, state: str, login_hint: str | None = None) -> str:
    q = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",  # we need a refresh token
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    if login_hint:
        q["login_hint"] = login_hint
    return f"{AUTH_URL}?{urlencode(q)}"


def _token_set(data: dict, previous_refresh: str | None = None) -> TokenSet:
    return TokenSet(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token") or previous_refresh,
        expires_at=datetime.now(UTC) + timedelta(seconds=int(data.get("expires_in", 3600))),
        scopes=data.get("scope"),
    )


def _post_token(http: httpx.Client, form: dict) -> dict:
    try:
        r = http.post(TOKEN_URL, data=form)
    except httpx.HTTPError as e:
        raise CalendarApiError(f"Google token endpoint unreachable: {e}") from e
    if r.status_code == 400 and "invalid_grant" in r.text:
        raise CalendarAuthError("Google access was revoked or expired")
    if r.status_code != 200:
        raise CalendarApiError(f"Google token error {r.status_code}: {r.text[:200]}")
    return r.json()


def exchange_code(http: httpx.Client, code: str, redirect_uri: str) -> TokenSet:
    data = _post_token(
        http,
        {
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    ts = _token_set(data)
    try:
        info = http.get(USERINFO, headers={"Authorization": f"Bearer {ts.access_token}"}).json()
        ts.account_email = (info.get("email") or "").lower() or None
    except (httpx.HTTPError, ValueError):
        pass
    return ts


def refresh(http: httpx.Client, refresh_token: str) -> TokenSet:
    data = _post_token(
        http,
        {
            "refresh_token": refresh_token,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "grant_type": "refresh_token",
        },
    )
    return _token_set(data, previous_refresh=refresh_token)


def _dt(node: dict) -> tuple[datetime | None, bool]:
    if "dateTime" in node:
        d = datetime.fromisoformat(node["dateTime"].replace("Z", "+00:00"))
        return (d.astimezone(UTC) if d.tzinfo else d.replace(tzinfo=UTC)), False
    if "date" in node:
        return datetime.fromisoformat(node["date"]).replace(tzinfo=UTC), True
    return None, False


def _parse(item: dict) -> RawEvent | None:
    start, all_day = _dt(item.get("start", {}))
    if start is None:
        return None
    end, _ = _dt(item.get("end", {}))
    conf = item.get("conferenceData") or {}
    entry = next(
        (e.get("uri") for e in conf.get("entryPoints", []) if e.get("entryPointType") == "video"),
        None,
    )
    url = extract_meeting_url(
        item.get("hangoutLink"), entry, item.get("location"), item.get("description")
    )
    attendees = [
        Attendee(
            email=(a.get("email") or "").lower(),
            name=a.get("displayName", ""),
            response=a.get("responseStatus", ""),
            is_self=bool(a.get("self")),
        )
        for a in item.get("attendees", [])
        if a.get("email") and not a.get("resource")  # skip meeting rooms
    ]
    return RawEvent(
        external_id=item["id"],
        title=item.get("summary") or "(no title)",
        start=start,
        end=end,
        meeting_url=url,
        attendees=attendees,
        organizer_email=((item.get("organizer") or {}).get("email") or "").lower() or None,
        cancelled=item.get("status") == "cancelled",
        all_day=all_day,
        version=item.get("etag"),
    )


def list_events(
    http: httpx.Client, access_token: str, time_min: datetime, time_max: datetime
) -> list[RawEvent]:
    out: list[RawEvent] = []
    params = {
        "timeMin": time_min.isoformat().replace("+00:00", "Z"),
        "timeMax": time_max.isoformat().replace("+00:00", "Z"),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": "250",
        "showDeleted": "true",  # so cancellations arrive as status=cancelled
        "conferenceDataVersion": "1",
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    for _ in range(20):  # page cap
        try:
            r = http.get(f"{API}/calendars/primary/events", params=params, headers=headers)
        except httpx.HTTPError as e:
            raise CalendarApiError(f"Google Calendar unreachable: {e}") from e
        if r.status_code in (401, 403) and "insufficient" not in r.text.lower():
            raise CalendarAuthError("Google rejected the access token")
        if r.status_code != 200:
            raise CalendarApiError(f"Google Calendar error {r.status_code}: {r.text[:200]}")
        body = r.json()
        for item in body.get("items", []):
            ev = _parse(item)
            if ev:
                out.append(ev)
        token = body.get("nextPageToken")
        if not token:
            break
        params["pageToken"] = token
    return out


def create_watch(
    http: httpx.Client, access_token: str, address: str, secret_token: str
) -> WatchInfo:
    channel = uuid.uuid4().hex
    expiry = datetime.now(UTC) + timedelta(days=6)
    r = http.post(
        f"{API}/calendars/primary/events/watch",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "id": channel,
            "type": "web_hook",
            "address": address,
            "token": secret_token,
            "expiration": int(expiry.timestamp() * 1000),
        },
    )
    if r.status_code != 200:
        raise CalendarApiError(f"Google watch failed {r.status_code}: {r.text[:200]}")
    body = r.json()
    exp = datetime.fromtimestamp(int(body.get("expiration", expiry.timestamp() * 1000)) / 1000, UTC)
    return WatchInfo(watch_id=channel, expires_at=exp, resource=body.get("resourceId"))


def stop_watch(http: httpx.Client, access_token: str, watch_id: str, resource: str | None) -> None:
    try:
        http.post(
            "https://www.googleapis.com/calendar/v3/channels/stop",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"id": watch_id, "resourceId": resource},
        )
    except httpx.HTTPError:
        pass  # best effort; the channel expires on its own


def revoke(http: httpx.Client, token: str) -> None:
    try:
        http.post("https://oauth2.googleapis.com/revoke", data={"token": token})
    except httpx.HTTPError:
        pass
