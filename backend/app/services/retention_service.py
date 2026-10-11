"""
Data retention (M10a). Runs nightly:

- per org: delete recordings, transcript segments, speaker events and bot artefacts of interviews
  older than `organizations.data_retention_days`; derived notes/analyses are kept but the
  interview is marked `transcript_purged_at` so the UI can explain that citations expired
- cached AI results (which contain candidate text) are dropped after AI_CACHE_RETENTION_DAYS;
  cost rows stay
- expired data exports are deleted from storage
- expired refresh tokens and invitations are cleaned up
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import storage
from app.core.config import settings
from app.models.ai_run import AIRun
from app.models.candidate import Candidate
from app.models.interview import (
    BotSession,
    Interview,
    Recording,
    SpeakerEvent,
    TranscriptSegment,
)
from app.models.job import Job
from app.models.tenancy import AuditLog, Invitation, Organization, RefreshToken

log = logging.getLogger(__name__)

BATCH = 200


def _now() -> datetime:
    return datetime.now(UTC)


def _delete_blobs(keys: list[str]) -> int:
    n = 0
    for k in {k for k in keys if k}:
        try:
            storage.delete(k)
            n += 1
        except Exception:
            log.warning("could not delete blob %s", k)
    return n


def purge_interview(db: Session, iv: Interview, now: datetime) -> dict:
    """Delete one interview's recordings/transcripts. Returns counts; commits nothing."""
    keys: list[str] = []
    recs = db.query(Recording).filter(Recording.interview_id == iv.id).all()
    keys += [r.blob_path for r in recs]
    for s in db.query(BotSession).filter(BotSession.interview_id == iv.id):
        keys += [c.get("blob") for c in (s.chunks or [])]
        keys += [s.screenshot_key, s.manifest_key]
        s.chunks, s.screenshot_key, s.manifest_key = [], None, None
    segs = db.query(TranscriptSegment).filter(TranscriptSegment.interview_id == iv.id).delete()
    events = db.query(SpeakerEvent).filter(SpeakerEvent.interview_id == iv.id).delete()
    db.query(Recording).filter(Recording.interview_id == iv.id).delete()
    iv.transcript_purged_at = now
    return {"recordings": len(recs), "segments": segs, "speaker_events": events, "keys": keys}


def purge_org(db: Session, org: Organization, now: datetime | None = None) -> dict:
    now = now or _now()
    cutoff = now - timedelta(days=org.data_retention_days)
    totals = {"interviews": 0, "recordings": 0, "segments": 0, "blobs": 0}
    touched_candidates: set[int] = set()
    while True:
        batch = (
            db.query(Interview)
            .filter(
                Interview.org_id == org.id,
                Interview.transcript_purged_at.is_(None),
                func.coalesce(Interview.scheduled_start, Interview.created_at) < cutoff,
                # never purge a meeting that is still being processed
                Interview.status.notin_(("in_progress", "processing")),
            )
            .order_by(Interview.id)
            .limit(BATCH)
            .all()
        )
        if not batch:
            break
        keys: list[str] = []
        for iv in batch:
            r = purge_interview(db, iv, now)
            keys += r.pop("keys")
            totals["interviews"] += 1
            totals["recordings"] += r["recordings"]
            totals["segments"] += r["segments"]
            touched_candidates.add(iv.candidate_id)
        db.commit()  # rows first; a crash then leaves orphan blobs, never dangling references
        totals["blobs"] += _delete_blobs(keys)

    # a candidate's legacy transcript file goes once none of their interviews keep a transcript
    for cid in touched_candidates:
        live = (
            db.query(Interview.id)
            .filter(Interview.candidate_id == cid, Interview.transcript_purged_at.is_(None))
            .first()
        )
        cand = db.get(Candidate, cid)
        if cand is not None and cand.transcript_path and live is None:
            totals["blobs"] += _delete_blobs([cand.transcript_path])
            cand.transcript_path = None
    if totals["interviews"]:
        db.add(
            AuditLog(
                org_id=org.id, user_id=None, action="retention.purged", entity_type="org",
                entity_id=str(org.id), metadata_={**totals, "retention_days": org.data_retention_days},
            )
        )
    db.commit()
    return totals


def purge_ai_results(db: Session, now: datetime | None = None) -> int:
    cutoff = (now or _now()) - timedelta(days=settings.ai_cache_retention_days)
    n = (
        db.query(AIRun)
        .filter(AIRun.result.isnot(None), AIRun.created_at < cutoff)
        .update({"result": None}, synchronize_session=False)
    )
    db.commit()
    return n


def expire_exports(db: Session, now: datetime | None = None) -> int:
    now = now or _now()
    n = 0
    for job in db.query(Job).filter(Job.kind == "export", Job.status == "completed"):
        r = dict(job.result or {})
        exp = r.get("expires_at")
        if not r.get("key") or not exp:
            continue
        if datetime.fromisoformat(exp) < now:
            _delete_blobs([r["key"]])
            job.result = {"expired": True, "files": r.get("files"), "tables": r.get("tables")}
            n += 1
    db.commit()
    return n


def cleanup_auth(db: Session, now: datetime | None = None) -> int:
    cutoff = (now or _now()) - timedelta(days=30)
    a = db.query(RefreshToken).filter(RefreshToken.expires_at < cutoff).delete()
    b = db.query(Invitation).filter(Invitation.expires_at < cutoff).delete()
    db.commit()
    return a + b


def run_nightly(db: Session, now: datetime | None = None) -> dict:
    now = now or _now()
    summary = {"orgs": {}, "ai_results_cleared": 0, "exports_expired": 0, "auth_rows_removed": 0}
    for org in db.query(Organization).order_by(Organization.id).all():
        try:
            summary["orgs"][org.id] = purge_org(db, org, now)
        except Exception:
            db.rollback()
            log.exception("retention failed for org %s", org.id)
    summary["ai_results_cleared"] = purge_ai_results(db, now)
    summary["exports_expired"] = expire_exports(db, now)
    summary["auth_rows_removed"] = cleanup_auth(db, now)
    return summary
