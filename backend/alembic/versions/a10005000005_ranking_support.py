"""resume raw_text, ai_runs.job_id, candidate_reveals (M5)

Revision ID: a10005000005
Revises: a10004000004
Create Date: 2026-10-10 15:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a10005000005"
down_revision: Union[str, Sequence[str], None] = "a10004000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("resume_profiles", sa.Column("raw_text", sa.Text(), nullable=True))
    op.add_column("ai_runs", sa.Column("job_id", sa.Integer(), nullable=True))
    op.create_index("ix_ai_runs_job_id", "ai_runs", ["job_id"])
    op.create_table(
        "candidate_reveals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "candidate_id", name="uq_candidate_reveals"),
    )
    op.create_index("ix_candidate_reveals_org_id", "candidate_reveals", ["org_id"])
    op.create_index("ix_candidate_reveals_user_id", "candidate_reveals", ["user_id"])
    op.create_index("ix_candidate_reveals_candidate_id", "candidate_reveals", ["candidate_id"])


def downgrade() -> None:
    op.drop_table("candidate_reveals")
    op.drop_index("ix_ai_runs_job_id", table_name="ai_runs")
    op.drop_column("ai_runs", "job_id")
    op.drop_column("resume_profiles", "raw_text")
