from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "intervue",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.worker.tasks.resume",
        "app.worker.tasks.analysis",
        "app.worker.tasks.bots",
        "app.worker.tasks.ranking",
        "app.worker.tasks.calendar",
        "app.worker.tasks.compliance",
        "app.worker.tasks.integrations",
    ],
)

celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=False,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="default",
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "bots-launch-due": {"task": "bots.launch_due", "schedule": 30.0},
        "bots-reap-stuck": {"task": "bots.reap_stuck", "schedule": 600.0},
        "calendar-sync": {
            "task": "calendar.sync_all",
            "schedule": float(settings.calendar_sync_minutes * 60),
        },
        "calendar-renew-watches": {"task": "calendar.renew_watches", "schedule": 3600.0},
        "webhooks-retry-due": {"task": "webhooks.retry_due", "schedule": 60.0},
        "retention-nightly": {"task": "compliance.retention_nightly", "schedule": crontab(hour=3, minute=0)},
    },
)
