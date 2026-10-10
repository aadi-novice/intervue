from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin

PROVIDERS = ("google", "microsoft")
AUTO_JOIN_MODES = ("all", "tagged", "never")


class CalendarConnection(Base, TimestampMixin, OrgScopedMixin):
    """One user's connected calendar account. Tokens are Fernet-encrypted at rest."""

    __tablename__ = "calendar_connections"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", "provider", "account_email", name="uq_calendar_conn"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # google | microsoft
    account_email: Mapped[str] = mapped_column(String(255), nullable=False)
    access_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str | None] = mapped_column(Text)
    # all = every matched interview, tagged = only events the user tagged, never = no bot
    auto_join: Mapped[str] = mapped_column(String(10), nullable=False, default="tagged")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # active | needs_reauth | error
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    # push notifications (Google channel id / Microsoft subscription id)
    watch_id: Mapped[str | None] = mapped_column(String(128), index=True)
    watch_resource: Mapped[str | None] = mapped_column(String(255))  # google resourceId
    watch_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CalendarEvent(Base, TimestampMixin, OrgScopedMixin):
    """A synced calendar event that has a supported meeting link."""

    __tablename__ = "calendar_events"
    __table_args__ = (UniqueConstraint("connection_id", "external_id", name="uq_calendar_event"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("calendar_connections.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meeting_url: Mapped[str | None] = mapped_column(Text)
    attendees: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    cancelled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    candidate_id: Mapped[int | None] = mapped_column(
        ForeignKey("candidates.id", ondelete="SET NULL"), index=True
    )
    tagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    interview_id: Mapped[int | None] = mapped_column(
        ForeignKey("interviews.id", ondelete="SET NULL"), index=True
    )
    # why no interview / no bot was created (shown in the UI)
    skip_reason: Mapped[str | None] = mapped_column(String(60))
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[str | None] = mapped_column(String(64))  # provider etag / hash
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
