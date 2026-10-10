from typing import TYPE_CHECKING

from sqlalchemy import Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin, VectorType

if TYPE_CHECKING:
    from app.models.candidate import Candidate
    from app.models.rubric import RubricCriterion

ROLE_STATUSES = ("open", "paused", "closed")


class Role(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("org_id", "name", name="uq_roles_org_name"),
        Index(
            "ix_roles_jd_embedding_hnsw",
            "jd_embedding",
            postgresql_using="hnsw",
            postgresql_ops={"jd_embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    experience_level: Mapped[str] = mapped_column(String(50), nullable=False)
    experience_required_years: Mapped[int] = mapped_column(nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    jd_embedding: Mapped[list | None] = mapped_column(VectorType(1536))

    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="role", cascade="all, delete"
    )
    rubric: Mapped[list["RubricCriterion"]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
        order_by="RubricCriterion.position",
    )
