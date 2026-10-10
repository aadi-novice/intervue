from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, declared_attr, mapped_column
from sqlalchemy.types import JSON, TypeDecorator
from sqlalchemy import Integer


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class OrgScopedMixin:
    """Every business table belongs to exactly one organization."""

    @declared_attr
    def org_id(cls) -> Mapped[int]:
        return mapped_column(
            Integer, ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False, index=True,
        )


class VectorType(TypeDecorator):
    """pgvector `vector(dim)` on PostgreSQL, JSON list elsewhere (SQLite tests)."""

    impl = JSON
    cache_ok = True

    def __init__(self, dim: int = 1536):
        super().__init__()
        self.dim = dim

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector

            return dialect.type_descriptor(Vector(self.dim))
        return dialect.type_descriptor(JSON(none_as_null=True))  # None -> SQL NULL
