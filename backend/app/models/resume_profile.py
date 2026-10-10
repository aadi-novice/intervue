from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin, VectorType

if TYPE_CHECKING:
    from app.models.candidate import Candidate


class ResumeProfile(Base, TimestampMixin, OrgScopedMixin):
    """Cached structured extraction of a resume (one LLM call per resume content)."""

    __tablename__ = "resume_profiles"
    __table_args__ = (
        Index(
            "ix_resume_profiles_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    basics: Mapped[dict] = mapped_column(JSON, nullable=False)
    summary: Mapped[str] = mapped_column(nullable=False)
    education: Mapped[list] = mapped_column(JSON, nullable=False)
    experience: Mapped[list] = mapped_column(JSON, nullable=False)
    projects: Mapped[list] = mapped_column(JSON, nullable=False)
    skills: Mapped[dict] = mapped_column(JSON, nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    raw_text: Mapped[str | None] = mapped_column(Text)  # extracted resume text (ranking evidence)
    embedding: Mapped[list | None] = mapped_column(VectorType(1536))

    candidate: Mapped["Candidate"] = relationship(back_populates="resume_profile")
