from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.core.redact import scrub
from app.models.job import Job


def create(
    db: Session, org_id: int, kind: str, entity_type: str, entity_id: int,
    requested_by: int | None = None,
) -> Job:
    """Create a queued job; 409 if an identical job is already queued/running."""
    active = (
        db.query(Job)
        .filter(
            Job.org_id == org_id,
            Job.kind == kind,
            Job.entity_type == entity_type,
            Job.entity_id == entity_id,
            Job.status.in_(("queued", "running")),
        )
        .first()
    )
    if active:
        raise Conflict(f"{kind} is already {active.status}", "job_in_progress")
    job = Job(
        org_id=org_id, kind=kind, entity_type=entity_type, entity_id=entity_id,
        requested_by_user_id=requested_by,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def latest(db: Session, org_id: int, kind: str, entity_type: str, entity_id: int) -> Job | None:
    return (
        db.query(Job)
        .filter(
            Job.org_id == org_id,
            Job.kind == kind,
            Job.entity_type == entity_type,
            Job.entity_id == entity_id,
        )
        .order_by(Job.id.desc())
        .first()
    )


def latest_for_candidate_interviews(db: Session, org_id: int, candidate_id: int) -> Job | None:
    """Newest analysis job across all of the candidate's interviews."""
    from app.models.interview import Interview

    ids = db.query(Interview.id).filter(
        Interview.org_id == org_id, Interview.candidate_id == candidate_id
    )
    return (
        db.query(Job)
        .filter(
            Job.org_id == org_id,
            Job.kind == "analysis",
            Job.entity_type == "interview",
            Job.entity_id.in_(ids),
        )
        .order_by(Job.id.desc())
        .first()
    )


def _announce(db: Session, job: Job) -> None:
    """Tell the requester a long-running job finished or failed (in-app)."""
    from app.services import notification_service as ns

    if not job.requested_by_user_id:
        return
    ok = job.status == "completed"
    if job.kind == "analysis":
        ns.notify(db, job.org_id, job.requested_by_user_id, "analysis",
                  "Interview analysis is ready" if ok else "Interview analysis failed",
                  None if ok else job.error, f"/interviews/{job.entity_id}?tab=analysis")
    elif job.kind == "rank":
        r = job.result or {}
        ns.notify(db, job.org_id, job.requested_by_user_id, "ranking",
                  "Ranking finished" if ok else "Ranking failed",
                  f"{r.get('scored', 0)} candidates scored" if ok else job.error,
                  f"/roles/{job.entity_id}?tab=ranking")
    elif job.kind == "export":
        ns.notify(db, job.org_id, job.requested_by_user_id, "export",
                  "Your data export is ready" if ok else "Your data export failed",
                  None if ok else job.error, "/settings?tab=privacy")


def set_status(
    db: Session, job_id: int, status: str, error: str | None = None, result: dict | None = None
) -> None:
    job = db.get(Job, job_id)
    if job is None:
        return
    previous = job.status
    job.status = status
    job.error = scrub(error) if error else None
    if result is not None:
        job.result = result
    db.commit()
    if status in ("completed", "failed") and previous != status:
        _announce(db, job)
