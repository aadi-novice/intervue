"""tenancy: organizations, users, memberships, audit, ai_runs; org_id backfill (M1.1)

Revision ID: a10001000001
Revises: b70d57e71847
Create Date: 2026-10-10 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a10001000001"
down_revision: Union[str, Sequence[str], None] = "b70d57e71847"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)
NOW = sa.text("now()")

BUSINESS_TABLES = ["roles", "candidates", "resume_profiles", "analyses"]


def _ts():
    return [
        sa.Column("created_at", TZ, nullable=False, server_default=NOW),
        sa.Column("updated_at", TZ, nullable=False, server_default=NOW),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("data_retention_days", sa.Integer(), nullable=False, server_default="365"),
        *_ts(),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("full_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("avatar_url", sa.String()),
        sa.Column("email_verified_at", TZ),
        sa.Column("last_login_at", TZ),
        *_ts(),
    )
    op.create_table(
        "oauth_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_user_id", sa.String(255), nullable=False),
        *_ts(),
        sa.UniqueConstraint("provider", "provider_user_id"),
    )
    op.create_index("ix_oauth_accounts_user_id", "oauth_accounts", ["user_id"])
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", TZ, nullable=False),
        sa.Column("revoked_at", TZ),
        sa.Column("user_agent", sa.String(500)),
        sa.Column("ip", sa.String(64)),
        *_ts(),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_table(
        "memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        *_ts(),
        sa.UniqueConstraint("org_id", "user_id"),
    )
    op.create_index("ix_memberships_org_id", "memberships", ["org_id"])
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])
    op.create_table(
        "invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", TZ, nullable=False),
        sa.Column("accepted_at", TZ),
        *_ts(),
    )
    op.create_index("ix_invitations_org_id", "invitations", ["org_id"])
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String(50)),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
        *_ts(),
    )
    op.create_index("ix_audit_logs_org_id", "audit_logs", ["org_id"])
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(80), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("prompt_version", sa.String(40), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(10, 5), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("cache_key", sa.String(64)),
        sa.Column("result", sa.JSON()),
        *_ts(),
    )
    op.create_index("ix_ai_runs_org_id", "ai_runs", ["org_id"])
    op.create_index("ix_ai_runs_purpose", "ai_runs", ["purpose"])
    op.create_index("ix_ai_runs_cache_key", "ai_runs", ["cache_key"])

    # Default org + backfill
    op.execute(
        "INSERT INTO organizations (name, slug, settings, data_retention_days) "
        "VALUES ('Default Org', 'default', '{}', 365)"
    )
    for table in BUSINESS_TABLES:
        op.add_column(table, sa.Column("org_id", sa.Integer(), nullable=True))
        op.execute(
            f"UPDATE {table} SET org_id = (SELECT id FROM organizations WHERE slug = 'default')"
        )
        op.alter_column(table, "org_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table}_org_id", table, "organizations", ["org_id"], ["id"], ondelete="CASCADE"
        )
        op.create_index(f"ix_{table}_org_id", table, ["org_id"])
        # timezone-aware timestamps + updated_at
        op.alter_column(
            table,
            "created_at",
            type_=TZ,
            postgresql_using="created_at AT TIME ZONE 'UTC'",
            existing_nullable=True,
        )
        op.add_column(table, sa.Column("updated_at", TZ, nullable=False, server_default=NOW))

    # created_at for tables that never had a NOT NULL guarantee
    op.execute("UPDATE analyses SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE resume_profiles SET created_at = now() WHERE created_at IS NULL")
    op.alter_column("analyses", "created_at", nullable=False, existing_type=TZ)
    op.alter_column("resume_profiles", "created_at", nullable=False, existing_type=TZ)

    # Per-org uniques replace global uniques (P3)
    op.drop_constraint("roles_name_key", "roles", type_="unique")
    op.create_unique_constraint("uq_roles_org_name", "roles", ["org_id", "name"])
    op.drop_constraint("candidates_email_key", "candidates", type_="unique")
    op.create_unique_constraint("uq_candidates_org_email", "candidates", ["org_id", "email"])


def downgrade() -> None:
    op.drop_constraint("uq_candidates_org_email", "candidates", type_="unique")
    op.create_unique_constraint("candidates_email_key", "candidates", ["email"])
    op.drop_constraint("uq_roles_org_name", "roles", type_="unique")
    op.create_unique_constraint("roles_name_key", "roles", ["name"])

    for table in reversed(BUSINESS_TABLES):
        op.drop_column(table, "updated_at")
        op.alter_column(
            table,
            "created_at",
            type_=sa.DateTime(),
            postgresql_using="created_at AT TIME ZONE 'UTC'",
            existing_nullable=False,
        )
        op.drop_index(f"ix_{table}_org_id", table_name=table)
        op.drop_constraint(f"fk_{table}_org_id", table, type_="foreignkey")
        op.drop_column(table, "org_id")

    for t in ["ai_runs", "audit_logs", "invitations", "memberships", "refresh_tokens",
              "oauth_accounts", "users", "organizations"]:
        op.drop_table(t)
