from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    String, 
    DateTime
)
from sqlalchemy.orm import (
    Mapped, 
    mapped_column, 
    relationship
)



from app.db.base import Base

if TYPE_CHECKING:
    from app.models.role import Role
    from app.models.analysis import Analysis
    from app.models.resume_profile import ResumeProfile

class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False
    )

    phone: Mapped[str] = mapped_column(
        String(30),
        nullable=True
    )

    status: Mapped[str] = mapped_column(
    String(50),
    default="applied"
    )

    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id")
    )

    resume_path: Mapped[str] = mapped_column(
        String,
        nullable=True
    )

    transcript_path: Mapped[str] = mapped_column(
        String,
        nullable=True
    )

    avatar_path: Mapped[str] = mapped_column(
        String,
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.utcnow
    )

    role: Mapped["Role"] = relationship(
        back_populates="candidates"
    )

    analyses: Mapped[list["Analysis"]] = relationship(
    back_populates="candidate",
    cascade="all, delete"
    )

    resume_profile: Mapped["ResumeProfile"] = relationship(
        back_populates="candidate",
        uselist=False,
        cascade="all, delete"
    )