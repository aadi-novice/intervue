"""Shared helpers for Celery tasks."""

from contextlib import contextmanager

from app.core.errors import DomainError
from app.db import session as db_session

# Anything that is a DomainError (not found, invalid input...) will not get better on retry.
NO_RETRY = (DomainError,)
MAX_RETRIES = 3


@contextmanager
def session_scope():
    db = db_session.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def retry_delay(retries: int) -> int:
    """Exponential backoff: 10s, 30s, 90s."""
    return 10 * (3**retries)
