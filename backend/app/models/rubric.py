from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.role import Role


class RubricCriterion(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "rubric_criteria"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # 0..1
    must_have: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    role: Mapped["Role"] = relationship(back_populates="rubric")


class RoleMatch(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "role_matches"
    __table_args__ = (UniqueConstraint("candidate_id", "role_id", name="uq_role_matches"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    vector_similarity: Mapped[float | None] = mapped_column(Float)
    # [{criterion_id, score 0-5, evidence: [quote], reasoning}]
    rubric_scores: Mapped[list | None] = mapped_column(JSON)
    overall_score: Mapped[float | None] = mapped_column(Float)  # 0-100
    must_have_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(80))
    prompt_version: Mapped[str | None] = mapped_column(String(40))
    # pending | shortlisted | scored | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    rubric_hash: Mapped[str | None] = mapped_column(String(64))


class IntakeBatch(Base, TimestampMixin, OrgScopedMixin):
    """Bulk resume upload progress (GET /batches/{id})."""

    __tablename__ = "intake_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    errors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
