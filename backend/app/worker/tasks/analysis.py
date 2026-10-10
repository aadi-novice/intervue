from app.services import analysis_service, job_service
from app.worker.base import MAX_RETRIES, NO_RETRY, retry_delay, session_scope
from app.worker.celery_app import celery_app


@celery_app.task(bind=True, name="analysis.run", max_retries=MAX_RETRIES)
def run_analysis_task(self, org_id: int, candidate_id: int, job_id: int):
    with session_scope() as db:
        job_service.set_status(db, job_id, "running")
        try:
            analysis = analysis_service.analyze_candidate(db, org_id, candidate_id)
        except NO_RETRY as exc:
            db.rollback()
            job_service.set_status(db, job_id, "failed", error=exc.detail)
            return
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                job_service.set_status(db, job_id, "failed", error=str(exc))
                return
            job_service.set_status(db, job_id, "queued", error=f"retrying: {exc}")
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))
        job_service.set_status(db, job_id, "completed", result={"analysis_id": analysis.id})
