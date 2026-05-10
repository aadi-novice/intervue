from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, DateTime
from app.db.base import Base
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship 
)

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.candidate import Candidate

class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.utcnow
    )

    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="role",
        cascade="all, delete"
    )

    experience_level: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )

    experience_required_years: Mapped[int] = mapped_column(
        nullable=False
    )