"""
Test configuration and shared fixtures.

Patches the database session module before any app imports to use
SQLite in-memory instead of PostgreSQL, so tests run without a real database.
"""

import os
import sys
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# ── Set test env vars before any app imports ────────────────────────────
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault(
    "AZURE_STORAGE_CONNECTION_STRING",
    "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net",
)

# ── Create test engine & session factory ───────────────────────────────
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=_test_engine,
)


# ── Mock app.db.session to use our test engine ──────────────────────────
# This prevents the real session.py from executing its module-level
# `create_engine(..., connect_args={"sslmode": "require"})` which would
# fail against SQLite.
class _MockSessionModule:
    engine = _test_engine
    SessionLocal = TestSessionLocal
    DATABASE_URL = "sqlite:///:memory:"


sys.modules["app.db.session"] = _MockSessionModule()

# ── Now safe to import app modules ─────────────────────────────────────
from app.db.base import Base
from app.db.dependencies import get_db
from app.main import app


@pytest.fixture(autouse=True)
def _setup_database() -> Generator[None, None, None]:
    """Create all tables before each test, drop them after."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    """Provide a SQLAlchemy session connected to the test DB."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _override_get_db() -> Generator[Session, None, None]:
    """FastAPI dependency override – uses test DB session."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    """FastAPI TestClient with database dependency overridden."""
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
