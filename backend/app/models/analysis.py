from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.candidate import Candidate


class Analysis(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    interview_id: Mapped[int | None] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"))

    summary: Mapped[str] = mapped_column(Text, nullable=False)
    strengths: Mapped[list] = mapped_column(JSON, nullable=False)
    weaknesses: Mapped[list] = mapped_column(JSON, nullable=False)
    key_moments: Mapped[list | None] = mapped_column(JSON)
    resume_alignment: Mapped[list | None] = mapped_column(JSON)
    technical_score: Mapped[int] = mapped_column(Integer, nullable=False)
    communication_score: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence_score: Mapped[int] = mapped_column(Integer, nullable=False)
    hiring_recommendation: Mapped[str | None] = mapped_column(String(20))
    model: Mapped[str | None] = mapped_column(String(80))
    prompt_version: Mapped[str | None] = mapped_column(String(40))

    candidate: Mapped["Candidate"] = relationship(back_populates="analyses")
