"""Structured JSON logging with a per-request id, plus Sentry initialisation."""

import logging
import sys
import uuid

import structlog

from app.core.config import settings

request_id_var = structlog.contextvars


def configure_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.format_exc_info,
    ]
    structlog.configure(
        processors=processors + [structlog.processors.JSONRenderer()],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )
    # Route stdlib logging (uvicorn, sqlalchemy, our modules) through structlog's JSON formatter.
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def init_sentry(component: str) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        send_default_pii=False,
        traces_sample_rate=0.05,
    )
    sentry_sdk.set_tag("component", component)


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]
