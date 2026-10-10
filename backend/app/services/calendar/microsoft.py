"""Microsoft Graph (Outlook / Microsoft 365) calendar adapter. Plain HTTPS, no vendor SDK."""

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

BASE = "https://login.microsoftonline.com/common/oauth2/v2.0"
AUTH_URL = f"{BASE}/authorize"
TOKEN_URL = f"{BASE}/token"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access User.Read Calendars.Read"
name = "microsoft"


def configured() -> bool:
    return bool(settings.microsoft_client_id and settings.microsoft_client_secret)


def authorize_url(redirect_uri: str, state: str, login_hint: str | None = None) -> str:
    q = {
        "client_id": settings.microsoft_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "response_mode": "query",
        "scope": SCOPES,
        "prompt": "select_account",
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
        raise CalendarApiError(f"Microsoft token endpoint unreachable: {e}") from e
    if r.status_code in (400, 401) and any(
        k in r.text for k in ("invalid_grant", "interaction_required", "consent_required")
    ):
        raise CalendarAuthError("Microsoft access was revoked or expired")
    if r.status_code != 200:
        raise CalendarApiError(f"Microsoft token error {r.status_code}: {r.text[:200]}")
    return r.json()


def exchange_code(http: httpx.Client, code: str, redirect_uri: str) -> TokenSet:
    data = _post_token(
        http,
        {
            "code": code,
            "client_id": settings.microsoft_client_id,
            "client_secret": settings.microsoft_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "scope": SCOPES,
        },
    )
    ts = _token_set(data)
    try:
        me = http.get(f"{GRAPH}/me", headers={"Authorization": f"Bearer {ts.access_token}"}).json()
        ts.account_email = (me.get("mail") or me.get("userPrincipalName") or "").lower() or None
    except (httpx.HTTPError, ValueError):
        pass
    return ts


def refresh(http: httpx.Client, refresh_token: str) -> TokenSet:
    data = _post_token(
        http,
        {
            "refresh_token": refresh_token,
            "client_id": settings.microsoft_client_id,
            "client_secret": settings.microsoft_client_secret,
            "grant_type": "refresh_token",
            "scope": SCOPES,
        },
    )
    return _token_set(data, previous_refresh=refresh_token)


def _dt(node: dict | None) -> datetime | None:
    if not node or not node.get("dateTime"):
        return None
    raw = node["dateTime"].split(".")[0]  # graph returns 7 fractional digits
    return datetime.fromisoformat(raw).replace(tzinfo=UTC)  # we ask for UTC via Prefer header


def _parse(item: dict) -> RawEvent | None:
    start = _dt(item.get("start"))
    if start is None:
        return None
    online = item.get("onlineMeeting") or {}
    url = extract_meeting_url(
        online.get("joinUrl"),
        item.get("onlineMeetingUrl"),
        (item.get("location") or {}).get("displayName"),
        item.get("bodyPreview"),
        (item.get("body") or {}).get("content"),
    )
    attendees = []
    for a in item.get("attendees", []):
        addr = (a.get("emailAddress") or {})
        email = (addr.get("address") or "").lower()
        if email and a.get("type") != "resource":
            attendees.append(
                Attendee(
                    email=email,
                    name=addr.get("name", ""),
                    response=(a.get("status") or {}).get("response", ""),
                )
            )
    org = ((item.get("organizer") or {}).get("emailAddress") or {}).get("address")
    return RawEvent(
        external_id=item["id"],
        title=item.get("subject") or "(no title)",
        start=start,
        end=_dt(item.get("end")),
        meeting_url=url,
        attendees=attendees,
        organizer_email=(org or "").lower() or None,
        cancelled=bool(item.get("isCancelled")),
        all_day=bool(item.get("isAllDay")),
        version=item.get("changeKey"),
    )


def list_events(
    http: httpx.Client, access_token: str, time_min: datetime, time_max: datetime
) -> list[RawEvent]:
    out: list[RawEvent] = []
    headers = {"Authorization": f"Bearer {access_token}", "Prefer": 'outlook.timezone="UTC"'}
    url: str | None = f"{GRAPH}/me/calendarView"
    params: dict | None = {
        "startDateTime": time_min.strftime("%Y-%m-%dT%H:%M:%S"),
        "endDateTime": time_max.strftime("%Y-%m-%dT%H:%M:%S"),
        "$top": "100",
        "$orderby": "start/dateTime",
        "$select": (
            "id,subject,start,end,isAllDay,isCancelled,attendees,organizer,onlineMeeting,"
            "onlineMeetingUrl,location,bodyPreview,body,changeKey"
        ),
    }
    for _ in range(20):
        try:
            r = http.get(url, params=params, headers=headers)
        except httpx.HTTPError as e:
            raise CalendarApiError(f"Microsoft Graph unreachable: {e}") from e
        if r.status_code == 401:
            raise CalendarAuthError("Microsoft rejected the access token")
        if r.status_code != 200:
            raise CalendarApiError(f"Microsoft Graph error {r.status_code}: {r.text[:200]}")
        body = r.json()
        for item in body.get("value", []):
            ev = _parse(item)
            if ev:
                out.append(ev)
        url, params = body.get("@odata.nextLink"), None
        if not url:
            break
    return out


def create_watch(http: httpx.Client, access_token: str, address: str, secret: str) -> WatchInfo:
    expiry = datetime.now(UTC) + timedelta(minutes=4200)  # Graph max for events is 4230 min
    r = http.post(
        f"{GRAPH}/subscriptions",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "changeType": "created,updated,deleted",
            "notificationUrl": address,
            "resource": "me/events",
            "expirationDateTime": expiry.strftime("%Y-%m-%dT%H:%M:%S.0000000Z"),
            "clientState": secret,
        },
    )
    if r.status_code not in (200, 201):
        raise CalendarApiError(f"Graph subscription failed {r.status_code}: {r.text[:200]}")
    return WatchInfo(watch_id=r.json()["id"], expires_at=expiry)


def renew_watch(http: httpx.Client, access_token: str, watch_id: str) -> WatchInfo:
    expiry = datetime.now(UTC) + timedelta(minutes=4200)
    r = http.patch(
        f"{GRAPH}/subscriptions/{watch_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"expirationDateTime": expiry.strftime("%Y-%m-%dT%H:%M:%S.0000000Z")},
    )
    if r.status_code != 200:
        raise CalendarApiError(f"Graph renew failed {r.status_code}: {r.text[:200]}")
    return WatchInfo(watch_id=watch_id, expires_at=expiry)


def stop_watch(http: httpx.Client, access_token: str, watch_id: str, resource: str | None) -> None:
    try:
        http.delete(
            f"{GRAPH}/subscriptions/{watch_id}", headers={"Authorization": f"Bearer {access_token}"}
        )
    except httpx.HTTPError:
        pass


def revoke(http: httpx.Client, token: str) -> None:
    return None  # Microsoft has no token revocation endpoint for this flow
