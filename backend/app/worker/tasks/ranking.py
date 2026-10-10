from app.services import intake_service, job_service, ranking_service, rubric_service
from app.worker.base import MAX_RETRIES, NO_RETRY, retry_delay, session_scope
from app.worker.celery_app import celery_app


@celery_app.task(bind=True, name="ranking.rank_role", max_retries=MAX_RETRIES)
def rank_role_task(self, org_id: int, role_id: int, job_id: int):
    """Two-stage ranking. Per-candidate scoring failures are recorded, not fatal."""
    with session_scope() as db:
        job_service.set_status(db, job_id, "running")
        try:
            result = ranking_service.rank_role(db, org_id, role_id, job_id)
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
        job_service.set_status(db, job_id, "completed", result=result)
        # resumes that arrived while we were scoring get a follow-up (debounced) run
        if ranking_service.unscored_count(db, org_id, role_id):
            ranking_service.schedule_rank(org_id, role_id)


@celery_app.task(bind=True, name="ranking.suggest_rubric", max_retries=MAX_RETRIES)
def suggest_rubric_task(self, org_id: int, role_id: int, job_id: int):
    with session_scope() as db:
        job_service.set_status(db, job_id, "running")
        try:
            result = rubric_service.run_suggestion(db, org_id, role_id, job_id)
        except NO_RETRY as exc:
            db.rollback()
            job_service.set_status(db, job_id, "failed", error=exc.detail)
            return
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                job_service.set_status(db, job_id, "failed", error=str(exc))
                return
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))
        job_service.set_status(db, job_id, "completed", result=result)


@celery_app.task(name="ranking.embed_role")
def embed_role_task(org_id: int, role_id: int):
    """After a JD or rubric edit: refresh the role embedding, then a debounced re-rank."""
    with session_scope() as db:
        ranking_service.embed_role(db, org_id, role_id)
    ranking_service.schedule_rank(org_id, role_id)


@celery_app.task(bind=True, name="intake.start_batch", max_retries=MAX_RETRIES)
def start_batch_task(self, org_id: int, batch_id: int, keys: list[str]):
    """Expand ZIPs, then fan out one task per resume."""
    with session_scope() as db:
        files = intake_service.expand(db, org_id, batch_id, keys)
    for key in files:
        process_resume_file_task.delay(org_id, batch_id, key)


@celery_app.task(name="intake.process_resume")
def process_resume_file_task(org_id: int, batch_id: int, key: str):
    with session_scope() as db:
        intake_service.process_file(db, org_id, batch_id, key)
