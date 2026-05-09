from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


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