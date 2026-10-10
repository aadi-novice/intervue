from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.candidate import Candidate

PLATFORMS = ("google_meet", "teams", "zoom", "jitsi", "upload")
INTERVIEW_STATUSES = (
    "scheduled",
    "in_progress",
    "processing",
    "completed",
    "failed",
    "cancelled",
)
BOT_STATUSES = (
    "scheduled",
    "launching",
    "joining",
    "waiting_admission",
    "in_call",
    "leaving",
    "completed",
    "failed",
)


class Interview(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meeting_url: Mapped[str | None] = mapped_column(Text)
    platform: Mapped[str] = mapped_column(String(20), nullable=False, default="upload")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    candidate: Mapped["Candidate"] = relationship(back_populates="interviews")
    participants: Mapped[list["InterviewParticipant"]] = relationship(
        back_populates="interview", cascade="all, delete-orphan"
    )
    bot_sessions: Mapped[list["BotSession"]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="BotSession.id",
    )
    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="TranscriptSegment.position",
    )
    notes: Mapped["InterviewNote | None"] = relationship(
        back_populates="interview", uselist=False, cascade="all, delete-orphan"
    )


class InterviewParticipant(Base, TimestampMixin):
    __tablename__ = "interview_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # interviewer|candidate|other

    interview: Mapped[Interview] = relationship(back_populates="participants")


class BotSession(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "bot_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="scheduled")
    # When the beat scheduler may launch this session (now, or scheduled_start - 1 min)
    launch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    failure_reason: Mapped[str | None] = mapped_column(String(50))
    failure_detail: Mapped[str | None] = mapped_column(Text)
    screenshot_key: Mapped[str | None] = mapped_column(String)
    container_ref: Mapped[str | None] = mapped_column(Text)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_message_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_message: Mapped[str | None] = mapped_column(Text)
    stop_requested: Mapped[bool] = mapped_column(default=False, nullable=False)
    recording_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # [{index, blob, start_ms, duration_ms}] as reported by the bot
    chunks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    manifest_key: Mapped[str | None] = mapped_column(String)

    interview: Mapped[Interview] = relationship(back_populates="bot_sessions")


class Recording(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    blob_path: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(50), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    size_bytes: Mapped[int | None] = mapped_column(Integer)


class SpeakerEvent(Base):
    __tablename__ = "speaker_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    t_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker_name: Mapped[str] = mapped_column(String(200), nullable=False)


class TranscriptSegment(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "transcript_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    speaker_label: Mapped[str] = mapped_column(String(200), nullable=False, default="Unknown")
    participant_id: Mapped[int | None] = mapped_column(
        ForeignKey("interview_participants.id", ondelete="SET NULL")
    )
    speaker_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    interview: Mapped[Interview] = relationship(back_populates="segments")


class InterviewNote(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "interview_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), unique=True
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    key_points: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    topics: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    follow_ups: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    model: Mapped[str | None] = mapped_column(String(80))
    prompt_version: Mapped[str | None] = mapped_column(String(40))

    interview: Mapped[Interview] = relationship(back_populates="notes")
