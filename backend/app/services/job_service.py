from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.models.job import Job


def create(db: Session, org_id: int, kind: str, entity_type: str, entity_id: int) -> Job:
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
    job = Job(org_id=org_id, kind=kind, entity_type=entity_type, entity_id=entity_id)
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


def set_status(
    db: Session, job_id: int, status: str, error: str | None = None, result: dict | None = None
) -> None:
    job = db.get(Job, job_id)
    if job is None:
        return
    job.status = status
    job.error = error[:2000] if error else None
    if result is not None:
        job.result = result
    db.commit()
