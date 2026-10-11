"""compliance: notifications, transcript purge marker, job requester, ai_runs.candidate_id (M10a)

Revision ID: a10007000007
Revises: a10006000006
Create Date: 2026-10-11 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a10007000007"
down_revision: Union[str, Sequence[str], None] = "a10006000006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("link", sa.String(300)),
        sa.Column("read_at", TZ),
        sa.Column("created_at", TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_notifications_org_id", "notifications", ["org_id"])
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_user_unread", "notifications", ["user_id", "read_at"])

    op.add_column("interviews", sa.Column("transcript_purged_at", TZ, nullable=True))
    op.add_column(
        "jobs",
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("ai_runs", sa.Column("candidate_id", sa.Integer(), nullable=True))
    op.create_index("ix_ai_runs_candidate_id", "ai_runs", ["candidate_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_runs_candidate_id", table_name="ai_runs")
    op.drop_column("ai_runs", "candidate_id")
    op.drop_column("jobs", "requested_by_user_id")
    op.drop_column("interviews", "transcript_purged_at")
    op.drop_table("notifications")
