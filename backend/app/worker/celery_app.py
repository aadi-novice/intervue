from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "intervue",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.worker.tasks.resume",
        "app.worker.tasks.analysis",
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
    beat_schedule={},
)
