from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import(
    DateTime,
    ForeignKey,
    Integer,
    Float,
    JSON,
    Text
)

from sqlalchemy.orm import(
    Mapped,
    mapped_column,
    relationship
)

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.candidate import Candidate



class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(
        primary_key = True

    )
    
    summary: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )

    strengths: Mapped[list] = mapped_column(
        JSON,
        nullable=False
    )

    weaknesses: Mapped[list] = mapped_column(
        JSON,
        nullable=False
    )

    key_moments: Mapped[list] = mapped_column(
        JSON,
        nullable=True 
    )
    
    technical_score: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )

    resume_alignment: Mapped[list] = mapped_column(
        JSON,
        nullable=True
    )

    communication_score: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )

    confidence_score: Mapped[int] = mapped_column(
        Integer,
        nullable=False 
    )
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )

    candidate: Mapped["Candidate"] = relationship(
        back_populates="analyses"
    )
