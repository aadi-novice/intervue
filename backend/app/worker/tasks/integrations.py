from app.services import slack_service, webhook_service
from app.worker.base import session_scope
from app.worker.celery_app import celery_app


@celery_app.task(name="webhooks.deliver")
def deliver_webhook_task(delivery_id: int) -> str:
    """One delivery attempt. Failures are rescheduled by the sweeper below (restart-safe)."""
    with session_scope() as db:
        return webhook_service.deliver(db, delivery_id)


@celery_app.task(name="webhooks.retry_due")
def retry_due_task() -> int:
    """Beat (every minute): re-attempt deliveries whose backoff has elapsed."""
    with session_scope() as db:
        ids = webhook_service.due_delivery_ids(db)
    for i in ids:
        deliver_webhook_task.delay(i)
    return len(ids)


@celery_app.task(name="slack.send")
def slack_send_task(org_id: int, text: str) -> bool:
    with session_scope() as db:
        ok, _ = slack_service.send(db, org_id, text)
        return ok
