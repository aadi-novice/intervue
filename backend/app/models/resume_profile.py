from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.candidate import Candidate


class ResumeProfile(Base):
    """
    Stores the result of a one-time AI structured extraction from a
    candidate's resume PDF. Re-used on every detail-page load so we
    never call the LLM more than once per resume.
    """
    __tablename__ = "resume_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)

    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id"),
        unique=True,          # one profile per candidate
        nullable=False
    )

    # Store the whole parsed JSON blob as returned by the AI
    basics: Mapped[dict] = mapped_column(JSON, nullable=False)
    summary: Mapped[str] = mapped_column(nullable=False)
    education: Mapped[list] = mapped_column(JSON, nullable=False)
    experience: Mapped[list] = mapped_column(JSON, nullable=False)
    projects: Mapped[list] = mapped_column(JSON, nullable=False)
    skills: Mapped[dict] = mapped_column(JSON, nullable=False)
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSON, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    candidate: Mapped["Candidate"] = relationship(
        back_populates="resume_profile"
    )
