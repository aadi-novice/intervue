from dataclasses import dataclass, field
from datetime import datetime


class CalendarAuthError(Exception):
    """The refresh token / consent is no longer valid: the user must reconnect."""


class CalendarApiError(Exception):
    """Transient or unexpected provider error (retry later)."""


@dataclass
class Attendee:
    email: str
    name: str = ""
    response: str = ""  # accepted | declined | tentative | needsAction | ""
    is_self: bool = False


@dataclass
class RawEvent:
    external_id: str
    title: str
    start: datetime  # timezone-aware UTC
    end: datetime | None
    meeting_url: str | None
    attendees: list[Attendee] = field(default_factory=list)
    organizer_email: str | None = None
    cancelled: bool = False
    all_day: bool = False
    version: str | None = None


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime
    scopes: str | None = None
    account_email: str | None = None


@dataclass
class WatchInfo:
    watch_id: str
    expires_at: datetime
    resource: str | None = None
