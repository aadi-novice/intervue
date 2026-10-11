from app.services import export_service, job_service, retention_service
from app.worker.base import session_scope
from app.worker.celery_app import celery_app


@celery_app.task(name="compliance.retention_nightly")
def retention_nightly_task() -> dict:
    """Beat (03:00 UTC): purge recordings/transcripts past each org's retention window."""
    with session_scope() as db:
        return retention_service.run_nightly(db)


@celery_app.task(name="compliance.export_org")
def export_org_task(org_id: int, job_id: int, include_recordings: bool = False):
    with session_scope() as db:
        job_service.set_status(db, job_id, "running")
        try:
            result = export_service.build_export(db, org_id, job_id, include_recordings)
        except Exception as exc:  # exports are user-triggered; report instead of retrying blindly
            db.rollback()
            job_service.set_status(db, job_id, "failed", error=str(exc))
            return
        job_service.set_status(db, job_id, "completed", result=result)
