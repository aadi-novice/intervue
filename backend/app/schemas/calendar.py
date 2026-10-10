from datetime import datetime
from typing import Literal

from pydantic import BaseModel

AutoJoin = Literal["all", "tagged", "never"]


class ProviderOut(BaseModel):
    provider: Literal["google", "microsoft"]
    configured: bool


class ConnectionOut(BaseModel):
    id: int
    provider: str
    account_email: str
    auto_join: AutoJoin
    status: Literal["active", "needs_reauth", "error"]
    last_synced_at: datetime | None = None
    last_error: str | None = None
    push_enabled: bool = False

    @classmethod
    def from_model(cls, c) -> "ConnectionOut":
        return cls(
            id=c.id, provider=c.provider, account_email=c.account_email, auto_join=c.auto_join,
            status=c.status, last_synced_at=c.last_synced_at, last_error=c.last_error,
            push_enabled=bool(c.watch_id),
        )


class ConnectUrl(BaseModel):
    url: str


class AutoJoinUpdate(BaseModel):
    auto_join: AutoJoin


class TagRequest(BaseModel):
    tagged: bool = True
    candidate_id: int | None = None


class EventCandidate(BaseModel):
    id: int
    name: str


class CalendarEventOut(BaseModel):
    id: int
    connection_id: int
    title: str
    start: datetime
    end: datetime | None = None
    meeting_url: str | None = None
    platform: str | None = None
    attendees: list[dict] = []
    candidate: EventCandidate | None = None
    tagged: bool
    interview_id: int | None = None
    bot_status: str | None = None
    skip_reason: str | None = None
