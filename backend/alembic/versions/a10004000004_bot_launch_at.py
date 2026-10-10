"""bot_sessions.launch_at for scheduled / queued launches (M4.5)

Revision ID: a10004000004
Revises: a10003000003
Create Date: 2026-10-10 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a10004000004"
down_revision: Union[str, Sequence[str], None] = "a10003000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bot_sessions", sa.Column("launch_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_bot_sessions_launch_at", "bot_sessions", ["launch_at"])


def downgrade() -> None:
    op.drop_index("ix_bot_sessions_launch_at", table_name="bot_sessions")
    op.drop_column("bot_sessions", "launch_at")
