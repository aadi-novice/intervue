from app.services import job_service, resume_service
from app.worker.base import MAX_RETRIES, NO_RETRY, retry_delay, session_scope
from app.worker.celery_app import celery_app


@celery_app.task(bind=True, name="resume.parse", max_retries=MAX_RETRIES)
def parse_resume(self, org_id: int, candidate_id: int, job_id: int | None = None):
    with session_scope() as db:
        if job_id:
            job_service.set_status(db, job_id, "running")
        try:
            resume_service.parse_resume(db, org_id, candidate_id)
        except NO_RETRY as exc:
            db.rollback()
            if job_id:
                job_service.set_status(db, job_id, "failed", error=exc.detail)
            return
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                if job_id:
                    job_service.set_status(
                        db, job_id, "failed",
                        error="We could not read this resume (it may be corrupt, password-protected or a scan).",
                    )
                    return
                raise
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))
        if job_id:
            job_service.set_status(db, job_id, "completed")
