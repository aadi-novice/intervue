from app.services import bot_service, job_service, recording_service
from app.worker.base import MAX_RETRIES, NO_RETRY, retry_delay, session_scope
from app.worker.celery_app import celery_app


@celery_app.task(bind=True, name="bots.process_recording", max_retries=MAX_RETRIES)
def process_recording_task(self, org_id: int, session_id: int):
    """concat chunks -> full recording -> submit to the transcriber."""
    with session_scope() as db:
        try:
            recording_service.process_recording(db, org_id, session_id)
        except NO_RETRY:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                _fail_interview(db, org_id, session_id)
                raise
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))


def _fail_interview(db, org_id: int, session_id: int) -> None:
    from app.models.interview import BotSession, Interview

    s = db.query(BotSession).filter(BotSession.id == session_id, BotSession.org_id == org_id).first()
    if s:
        iv = db.get(Interview, s.interview_id)
        if iv:
            iv.status = "failed"
            db.commit()


@celery_app.task(bind=True, name="bots.finish_transcription", max_retries=MAX_RETRIES)
def finish_transcription_task(self, org_id: int, job_id: int):
    """Triggered by the transcriber callback: align, map, notes, analysis, notify."""
    with session_scope() as db:
        try:
            recording_service.finish_transcription(db, org_id, job_id)
        except NO_RETRY:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                job_service.set_status(db, job_id, "failed", error=str(exc))
                raise
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))


@celery_app.task(name="bots.launch_due")
def launch_due_task() -> int:
    """Beat: start scheduled bots (interview start - 1 min) and drain the capacity queue."""
    with session_scope() as db:
        return bot_service.launch_due(db)


@celery_app.task(name="bots.reap_stuck")
def reap_stuck_task() -> int:
    with session_scope() as db:
        return bot_service.reap_stuck(db)


@celery_app.task(bind=True, name="bots.transcribe_upload", max_retries=MAX_RETRIES)
def transcribe_upload_task(self, org_id: int, interview_id: int, audio_key: str):
    """Submit a user-uploaded audio/video file to the transcriber."""
    with session_scope() as db:
        try:
            recording_service.submit_transcription(db, org_id, interview_id, audio_key)
        except NO_RETRY:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            if self.request.retries >= MAX_RETRIES:
                _fail_interview_by_id(db, interview_id)
                raise
            raise self.retry(exc=exc, countdown=retry_delay(self.request.retries))


def _fail_interview_by_id(db, interview_id: int) -> None:
    from app.models.interview import Interview

    iv = db.get(Interview, interview_id)
    if iv:
        iv.status = "failed"
        db.commit()
