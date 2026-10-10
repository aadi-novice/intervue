from app.services import resume_service
from app.worker.base import MAX_RETRIES, NO_RETRY, retry_delay, session_scope
from app.worker.celery_app import celery_app


@celery_app.task(bind=True, name="resume.parse", max_retries=MAX_RETRIES)
def parse_resume(self, org_id: int, candidate_id: int):
    with session_scope() as db:
        try:
            resume_service.parse_resume(db, org_id, candidate_id)
        except NO_RETRY:
            raise
        except Exception as exc:
            if self.request.retries >= MAX_RETRIES:
                raise
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))
