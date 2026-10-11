"""
Full organization data export (M10a): a ZIP with every table as JSON plus the original files.

Secrets never leave: password hashes, OAuth/refresh tokens, embeddings, invitation tokens and
cached AI results are excluded. Admin only; every request and download is audited.
"""

import json
import logging
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import storage
from app.core.config import settings
from app.core.errors import Conflict, NotFound
from app.models import (
    AIRun,
    Analysis,
    AuditLog,
    BotSession,
    CalendarConnection,
    CalendarEvent,
    Candidate,
    CandidateReveal,
    IntakeBatch,
    Interview,
    InterviewNote,
    InterviewParticipant,
    Invitation,
    Job,
    Membership,
    Notification,
    Organization,
    Recording,
    ResumeProfile,
    Role,
    RoleMatch,
    RubricCriterion,
    SpeakerEvent,
    TranscriptSegment,
    User,
)
from app.services import audit_service, job_service, org_service

log = logging.getLogger(__name__)
KIND = "export"

# columns that must never be exported
EXCLUDE = {
    "password_hash", "access_token_enc", "refresh_token_enc", "token_hash", "token", "embedding",
    "jd_embedding", "result", "cache_key", "container_ref", "watch_id", "watch_resource",
}

# (file name, model, how to scope to the org)
_BY_ORG = [
    ("roles", Role), ("rubric_criteria", RubricCriterion), ("candidates", Candidate),
    ("resume_profiles", ResumeProfile), ("role_matches", RoleMatch), ("interviews", Interview),
    ("bot_sessions", BotSession), ("transcript_segments", TranscriptSegment),
    ("interview_notes", InterviewNote), ("analyses", Analysis), ("recordings", Recording),
    ("intake_batches", IntakeBatch), ("candidate_reveals", CandidateReveal),
    ("calendar_connections", CalendarConnection), ("calendar_events", CalendarEvent),
    ("audit_logs", AuditLog), ("notifications", Notification), ("ai_runs", AIRun),
    ("invitations", Invitation), ("jobs", Job),
]


def _jsonable(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def _row(obj, extra: dict | None = None) -> dict:
    out = {
        c.key: _jsonable(getattr(obj, c.key))
        for c in inspect(type(obj)).mapper.column_attrs
        if c.columns[0].name not in EXCLUDE and c.key not in EXCLUDE
    }
    if extra:
        out.update(extra)
    return out


def _write_table(zf: zipfile.ZipFile, name: str, rows) -> int:
    n = 0
    with zf.open(f"data/{name}.json", "w") as f:
        f.write(b"[")
        for i, r in enumerate(rows):
            f.write((b"," if i else b"") + json.dumps(r, default=str).encode())
            n += 1
        f.write(b"]")
    return n


def request_export(db: Session, ctx: OrgContext, include_recordings: bool = False) -> Job:
    job = job_service.create(db, ctx.org_id, KIND, "org", ctx.org_id, requested_by=ctx.user.id)
    audit_service.record(db, ctx, "export.requested", "org", ctx.org_id, recordings=include_recordings)
    db.commit()
    from app.worker.tasks.compliance import export_org_task

    export_org_task.delay(ctx.org_id, job.id, include_recordings)
    return job


def build_export(db: Session, org_id: int, job_id: int, include_recordings: bool) -> dict:
    """Write the ZIP to a temp file, upload it, return the job result."""
    org = db.get(Organization, org_id)
    if org is None:
        raise NotFound("Organization not found")
    key = f"{org_id}/exports/{uuid.uuid4()}.zip"
    tables: dict[str, int] = {}
    files = 0
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "export.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            org_row = _row(org)
            org_row["settings"] = org_service.public_settings(org.settings)  # no encrypted secrets
            tables["organization"] = _write_table(zf, "organization", [org_row])
            members = (
                db.query(Membership, User).join(User, User.id == Membership.user_id)
                .filter(Membership.org_id == org_id).all()
            )
            tables["members"] = _write_table(
                zf, "members",
                [{"user_id": u.id, "email": u.email, "full_name": u.full_name, "role": m.role} for m, u in members],
            )
            interview_ids = [i for (i,) in db.query(Interview.id).filter(Interview.org_id == org_id)]
            for name, model in _BY_ORG:
                q = db.query(model).filter(model.org_id == org_id).yield_per(500)
                tables[name] = _write_table(zf, name, (_row(o) for o in q))
            if interview_ids:
                tables["interview_participants"] = _write_table(
                    zf, "interview_participants",
                    (_row(o) for o in db.query(InterviewParticipant).filter(
                        InterviewParticipant.interview_id.in_(interview_ids)).yield_per(500)),
                )
                tables["speaker_events"] = _write_table(
                    zf, "speaker_events",
                    (_row(o) for o in db.query(SpeakerEvent).filter(
                        SpeakerEvent.interview_id.in_(interview_ids)).yield_per(500)),
                )
            # original files
            def add_file(arcname: str, blob_key: str | None, compress: bool = True) -> None:
                nonlocal files
                if not blob_key:
                    return
                local = Path(tmp) / f"blob-{files}"
                try:
                    storage.download_file(blob_key, str(local))
                except Exception:
                    log.warning("export: missing blob %s", blob_key)
                    return
                zf.write(local, arcname, zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED)
                local.unlink(missing_ok=True)
                files += 1

            for c in db.query(Candidate).filter(Candidate.org_id == org_id).yield_per(200):
                add_file(f"files/resumes/{c.id}-{Path(c.resume_path or '').name}", c.resume_path)
                add_file(f"files/avatars/{c.id}-{Path(c.avatar_path or '').name}", c.avatar_path)
                add_file(f"files/transcripts/{c.id}-{Path(c.transcript_path or '').name}", c.transcript_path)
            if include_recordings:
                for r in db.query(Recording).filter(Recording.org_id == org_id).yield_per(50):
                    add_file(f"files/recordings/{r.interview_id}-{Path(r.blob_path).name}", r.blob_path, False)
            zf.writestr(
                "README.txt",
                f"Intervue data export for {org.name}\nGenerated {datetime.now(UTC).isoformat()}\n"
                "data/*.json: one file per table. files/: original uploads"
                f"{' and recordings' if include_recordings else ' (recordings were not included)'}.\n"
                "Excluded for security: password hashes, OAuth tokens, embeddings, cached AI results.\n",
            )
        size = path.stat().st_size
        storage.upload_file(key, str(path), "application/zip")
    expires = datetime.now(UTC) + timedelta(days=settings.export_retention_days)
    return {
        "key": key, "size_bytes": size, "files": files, "tables": tables,
        "include_recordings": include_recordings, "expires_at": expires.isoformat(),
    }


def latest(db: Session, ctx: OrgContext) -> Job | None:
    return job_service.latest(db, ctx.org_id, KIND, "org", ctx.org_id)


def download_url(db: Session, ctx: OrgContext) -> tuple[Job, str]:
    job = latest(db, ctx)
    if job is None or job.status != "completed":
        raise NotFound("No export is ready", "no_export")
    r = job.result or {}
    if r.get("expired") or not r.get("key"):
        raise Conflict("This export has expired; request a new one", "export_expired")
    audit_service.record(db, ctx, "export.downloaded", "org", ctx.org_id)
    db.commit()
    return job, storage.presigned_get(r["key"], 900)
