"""calendar connections and synced events (M6)

Revision ID: a10006000006
Revises: a10005000005
Create Date: 2026-10-11 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a10006000006"
down_revision: Union[str, Sequence[str], None] = "a10005000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _ts():
    return [
        sa.Column("created_at", TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TZ, nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "calendar_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("account_email", sa.String(255), nullable=False),
        sa.Column("access_token_enc", sa.Text(), nullable=False),
        sa.Column("refresh_token_enc", sa.Text()),
        sa.Column("token_expires_at", TZ),
        sa.Column("scopes", sa.Text()),
        sa.Column("auto_join", sa.String(10), nullable=False, server_default="tagged"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("last_synced_at", TZ),
        sa.Column("last_error", sa.Text()),
        sa.Column("watch_id", sa.String(128)),
        sa.Column("watch_resource", sa.String(255)),
        sa.Column("watch_expires_at", TZ),
        *_ts(),
        sa.UniqueConstraint("org_id", "user_id", "provider", "account_email", name="uq_calendar_conn"),
    )
    op.create_index("ix_calendar_connections_org_id", "calendar_connections", ["org_id"])
    op.create_index("ix_calendar_connections_user_id", "calendar_connections", ["user_id"])
    op.create_index("ix_calendar_connections_watch_id", "calendar_connections", ["watch_id"])

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("start", TZ, nullable=False),
        sa.Column("end", TZ),
        sa.Column("meeting_url", sa.Text()),
        sa.Column("attendees", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("cancelled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("candidates.id", ondelete="SET NULL")),
        sa.Column("tagged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("interview_id", sa.Integer(), sa.ForeignKey("interviews.id", ondelete="SET NULL")),
        sa.Column("skip_reason", sa.String(60)),
        sa.Column("seen_at", TZ),
        sa.Column("version", sa.String(64)),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        *_ts(),
        sa.UniqueConstraint("connection_id", "external_id", name="uq_calendar_event"),
    )
    op.create_index("ix_calendar_events_org_id", "calendar_events", ["org_id"])
    op.create_index("ix_calendar_events_connection_id", "calendar_events", ["connection_id"])
    op.create_index("ix_calendar_events_start", "calendar_events", ["start"])
    op.create_index("ix_calendar_events_candidate_id", "calendar_events", ["candidate_id"])
    op.create_index("ix_calendar_events_interview_id", "calendar_events", ["interview_id"])


def downgrade() -> None:
    op.drop_table("calendar_events")
    op.drop_table("calendar_connections")
