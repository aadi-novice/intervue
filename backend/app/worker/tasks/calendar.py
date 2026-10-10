from app.services import calendar_service
from app.worker.base import session_scope
from app.worker.celery_app import celery_app


@celery_app.task(name="calendar.sync_connection")
def sync_connection_task(connection_id: int) -> dict:
    """Sync one calendar. Provider errors are recorded on the connection, not retried here:
    the beat sweep (and push notifications) call it again."""
    with session_scope() as db:
        r = calendar_service.sync_connection(db, connection_id)
        return {"seen": r.seen, "created": r.created, "updated": r.updated,
                "cancelled": r.cancelled, "bots": r.bots}


@celery_app.task(name="calendar.sync_all")
def sync_all_task() -> int:
    """Beat: every few minutes, fan out one task per active connection."""
    with session_scope() as db:
        ids = calendar_service.due_connection_ids(db)
    for cid in ids:
        sync_connection_task.delay(cid)
    return len(ids)


@celery_app.task(name="calendar.renew_watches")
def renew_watches_task() -> int:
    with session_scope() as db:
        return calendar_service.renew_due_watches(db)
