from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OrgScopedMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.analysis import Analysis
    from app.models.interview import Interview
    from app.models.resume_profile import ResumeProfile
    from app.models.role import Role


class Candidate(Base, TimestampMixin, OrgScopedMixin):
    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("org_id", "email", name="uq_candidates_org_email"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(50), default="applied")
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    source: Mapped[str | None] = mapped_column(String(30))  # upload|bulk|ats|manual

    # Object-storage keys ({org_id}/{prefix}/{uuid}.{ext}); never URLs
    resume_path: Mapped[str | None] = mapped_column(String)
    transcript_path: Mapped[str | None] = mapped_column(String)
    avatar_path: Mapped[str | None] = mapped_column(String)

    role: Mapped["Role"] = relationship(back_populates="candidates")
    analyses: Mapped[list["Analysis"]] = relationship(
        back_populates="candidate", cascade="all, delete"
    )
    resume_profile: Mapped["ResumeProfile | None"] = relationship(
        back_populates="candidate", uselist=False, cascade="all, delete"
    )
    interviews: Mapped[list["Interview"]] = relationship(
        back_populates="candidate", cascade="all, delete"
    )
