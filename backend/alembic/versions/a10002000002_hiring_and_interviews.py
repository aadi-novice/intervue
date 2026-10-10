"""hiring (rubric, role_matches, batches) and interviews/transcripts tables (§4.2, §4.3)

Revision ID: a10002000002
Revises: a10001000001
Create Date: 2026-10-10 12:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "a10002000002"
down_revision: Union[str, Sequence[str], None] = "a10001000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)
NOW = sa.text("now()")


def _ts():
    return [
        sa.Column("created_at", TZ, nullable=False, server_default=NOW),
        sa.Column("updated_at", TZ, nullable=False, server_default=NOW),
    ]


def _org():
    return sa.Column(
        "org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )


def _fk(col: str, target: str, ondelete: str | None = None, nullable: bool = False):
    return sa.Column(col, sa.Integer(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    # --- column additions on existing tables
    op.add_column("roles", sa.Column("description", sa.Text()))
    op.add_column("roles", sa.Column("status", sa.String(20), nullable=False, server_default="open"))
    op.add_column("roles", sa.Column("jd_embedding", Vector(1536)))
    op.add_column("candidates", sa.Column("source", sa.String(30)))
    op.add_column("resume_profiles", sa.Column("content_hash", sa.String(64)))
    op.add_column("resume_profiles", sa.Column("embedding", Vector(1536)))
    op.create_index("ix_resume_profiles_content_hash", "resume_profiles", ["content_hash"])
    op.execute(
        "CREATE INDEX ix_roles_jd_embedding_hnsw ON roles USING hnsw (jd_embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX ix_resume_profiles_embedding_hnsw ON resume_profiles "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # --- rubric / matching
    op.create_table(
        "rubric_criteria",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("role_id", "roles.id", "CASCADE"),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("weight", sa.Float(), nullable=False, server_default="0"),
        sa.Column("must_have", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        *_ts(),
    )
    op.create_index("ix_rubric_criteria_org_id", "rubric_criteria", ["org_id"])
    op.create_index("ix_rubric_criteria_role_id", "rubric_criteria", ["role_id"])

    op.create_table(
        "role_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("candidate_id", "candidates.id", "CASCADE"),
        _fk("role_id", "roles.id", "CASCADE"),
        sa.Column("vector_similarity", sa.Float()),
        sa.Column("rubric_scores", sa.JSON()),
        sa.Column("overall_score", sa.Float()),
        sa.Column("must_have_failed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("explanation", sa.Text()),
        sa.Column("model", sa.String(80)),
        sa.Column("prompt_version", sa.String(40)),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("rubric_hash", sa.String(64)),
        *_ts(),
        sa.UniqueConstraint("candidate_id", "role_id", name="uq_role_matches"),
    )
    op.create_index("ix_role_matches_org_id", "role_matches", ["org_id"])
    op.create_index("ix_role_matches_candidate_id", "role_matches", ["candidate_id"])
    op.create_index("ix_role_matches_role_id", "role_matches", ["role_id"])

    op.create_table(
        "intake_batches",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("role_id", "roles.id", "CASCADE"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("errors", sa.JSON(), nullable=False, server_default="[]"),
        *_ts(),
    )
    op.create_index("ix_intake_batches_org_id", "intake_batches", ["org_id"])
    op.create_index("ix_intake_batches_role_id", "intake_batches", ["role_id"])

    # --- interviews
    op.create_table(
        "interviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("candidate_id", "candidates.id", "CASCADE"),
        _fk("role_id", "roles.id", "SET NULL", nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("scheduled_start", TZ),
        sa.Column("scheduled_end", TZ),
        sa.Column("meeting_url", sa.Text()),
        sa.Column("platform", sa.String(20), nullable=False, server_default="upload"),
        sa.Column("status", sa.String(20), nullable=False, server_default="scheduled"),
        _fk("created_by_user_id", "users.id", "SET NULL", nullable=True),
        *_ts(),
    )
    op.create_index("ix_interviews_org_id", "interviews", ["org_id"])
    op.create_index("ix_interviews_candidate_id", "interviews", ["candidate_id"])

    op.create_table(
        "interview_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        _fk("interview_id", "interviews.id", "CASCADE"),
        _fk("user_id", "users.id", "SET NULL", nullable=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(255)),
        sa.Column("kind", sa.String(20), nullable=False),
        *_ts(),
    )
    op.create_index("ix_interview_participants_interview_id", "interview_participants", ["interview_id"])

    op.create_table(
        "bot_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("interview_id", "interviews.id", "CASCADE"),
        sa.Column("status", sa.String(30), nullable=False, server_default="scheduled"),
        sa.Column("failure_reason", sa.String(50)),
        sa.Column("failure_detail", sa.Text()),
        sa.Column("screenshot_key", sa.String()),
        sa.Column("container_ref", sa.Text()),
        sa.Column("joined_at", TZ),
        sa.Column("left_at", TZ),
        sa.Column("consent_message_sent_at", TZ),
        sa.Column("consent_message", sa.Text()),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("recording_started_at", TZ),
        sa.Column("chunks", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("manifest_key", sa.String()),
        *_ts(),
    )
    op.create_index("ix_bot_sessions_org_id", "bot_sessions", ["org_id"])
    op.create_index("ix_bot_sessions_interview_id", "bot_sessions", ["interview_id"])

    op.create_table(
        "recordings",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("interview_id", "interviews.id", "CASCADE"),
        sa.Column("blob_path", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(50), nullable=False),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("size_bytes", sa.Integer()),
        *_ts(),
    )
    op.create_index("ix_recordings_org_id", "recordings", ["org_id"])
    op.create_index("ix_recordings_interview_id", "recordings", ["interview_id"])

    op.create_table(
        "speaker_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        _fk("interview_id", "interviews.id", "CASCADE"),
        sa.Column("t_ms", sa.Integer(), nullable=False),
        sa.Column("speaker_name", sa.String(200), nullable=False),
    )
    op.create_index("ix_speaker_events_interview_id", "speaker_events", ["interview_id"])

    op.create_table(
        "transcript_segments",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _fk("interview_id", "interviews.id", "CASCADE"),
        sa.Column("speaker_label", sa.String(200), nullable=False, server_default="Unknown"),
        _fk("participant_id", "interview_participants.id", "SET NULL", nullable=True),
        sa.Column("speaker_kind", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("start_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("end_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        *_ts(),
    )
    op.create_index("ix_transcript_segments_org_id", "transcript_segments", ["org_id"])
    op.create_index("ix_transcript_segments_interview_id", "transcript_segments", ["interview_id"])

    op.create_table(
        "interview_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        sa.Column(
            "interview_id", sa.Integer(), sa.ForeignKey("interviews.id", ondelete="CASCADE"),
            nullable=False, unique=True,
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("key_points", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("topics", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("follow_ups", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("model", sa.String(80)),
        sa.Column("prompt_version", sa.String(40)),
        *_ts(),
    )
    op.create_index("ix_interview_notes_org_id", "interview_notes", ["org_id"])

    # --- analyses link to interviews/roles
    op.add_column("analyses", sa.Column("interview_id", sa.Integer(), nullable=True))
    op.add_column("analyses", sa.Column("role_id", sa.Integer(), nullable=True))
    op.add_column("analyses", sa.Column("hiring_recommendation", sa.String(20)))
    op.add_column("analyses", sa.Column("model", sa.String(80)))
    op.add_column("analyses", sa.Column("prompt_version", sa.String(40)))
    op.create_foreign_key(
        "fk_analyses_interview_id", "analyses", "interviews", ["interview_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_analyses_role_id", "analyses", "roles", ["role_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_analyses_interview_id", "analyses", ["interview_id"])
    op.create_index("ix_analyses_candidate_id", "analyses", ["candidate_id"])
    # candidates delete must cascade at DB level too
    op.drop_constraint("analyses_candidate_id_fkey", "analyses", type_="foreignkey")
    op.create_foreign_key(
        "analyses_candidate_id_fkey", "analyses", "candidates", ["candidate_id"], ["id"], ondelete="CASCADE"
    )
    op.drop_constraint("resume_profiles_candidate_id_fkey", "resume_profiles", type_="foreignkey")
    op.create_foreign_key(
        "resume_profiles_candidate_id_fkey", "resume_profiles", "candidates", ["candidate_id"], ["id"],
        ondelete="CASCADE",
    )
    # backfill analyses.role_id from the candidate's role
    op.execute(
        "UPDATE analyses SET role_id = (SELECT role_id FROM candidates WHERE candidates.id = analyses.candidate_id)"
    )


def downgrade() -> None:
    op.drop_constraint("resume_profiles_candidate_id_fkey", "resume_profiles", type_="foreignkey")
    op.create_foreign_key(
        "resume_profiles_candidate_id_fkey", "resume_profiles", "candidates", ["candidate_id"], ["id"]
    )
    op.drop_constraint("analyses_candidate_id_fkey", "analyses", type_="foreignkey")
    op.create_foreign_key(
        "analyses_candidate_id_fkey", "analyses", "candidates", ["candidate_id"], ["id"]
    )
    op.drop_index("ix_analyses_candidate_id", table_name="analyses")
    op.drop_index("ix_analyses_interview_id", table_name="analyses")
    op.drop_constraint("fk_analyses_role_id", "analyses", type_="foreignkey")
    op.drop_constraint("fk_analyses_interview_id", "analyses", type_="foreignkey")
    for col in ["prompt_version", "model", "hiring_recommendation", "role_id", "interview_id"]:
        op.drop_column("analyses", col)

    for t in ["interview_notes", "transcript_segments", "speaker_events", "recordings",
              "bot_sessions", "interview_participants", "interviews", "intake_batches",
              "role_matches", "rubric_criteria"]:
        op.drop_table(t)

    op.execute("DROP INDEX IF EXISTS ix_resume_profiles_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_roles_jd_embedding_hnsw")
    op.drop_index("ix_resume_profiles_content_hash", table_name="resume_profiles")
    op.drop_column("resume_profiles", "embedding")
    op.drop_column("resume_profiles", "content_hash")
    op.drop_column("candidates", "source")
    op.drop_column("roles", "jd_embedding")
    op.drop_column("roles", "status")
    op.drop_column("roles", "description")
