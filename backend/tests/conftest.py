"""
Test configuration and shared fixtures.

Patches the database session module before any app imports so tests run on SQLite in-memory
instead of PostgreSQL, and runs Celery tasks eagerly (no broker needed).
"""

import os
import sys
from typing import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# ── Set test env vars before any app imports ────────────────────────────
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
os.environ["EMAIL_BACKEND"] = "console"
os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault("S3_BUCKET", "intervue-test")
os.environ.setdefault("S3_ACCESS_KEY_ID", "testing")
os.environ.setdefault("S3_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("S3_REGION", "us-east-1")
os.environ.setdefault("INTERNAL_HMAC_SECRET", "test-internal-secret")

# ── Create test engine & session factory ───────────────────────────────
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


class _MockSessionModule:
    engine = _test_engine
    SessionLocal = TestSessionLocal
    DATABASE_URL = "sqlite:///:memory:"


sys.modules["app.db.session"] = _MockSessionModule()

# ── Now safe to import app modules ─────────────────────────────────────
from app.core import email as mailer  # noqa: E402
from app.core import rate_limit, security  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.dependencies import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.tenancy import Membership, Organization, User  # noqa: E402


@pytest.fixture(autouse=True)
def _setup_database() -> Generator[None, None, None]:
    Base.metadata.create_all(bind=_test_engine)
    rate_limit.reset()
    mailer.outbox.clear()
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _override_get_db() -> Generator[Session, None, None]:
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Tenancy fixtures ────────────────────────────────────────────────────
def _make_org(db: Session, name: str) -> Organization:
    org = Organization(name=name, slug=name.lower().replace(" ", "-"), settings={})
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def _make_user(db: Session, org: Organization | None, email: str, role: str = "admin") -> User:
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email, full_name=email.split("@")[0].title(),
            password_hash=security.hash_password("Password123"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    if org is not None:
        db.add(Membership(org_id=org.id, user_id=user.id, role=role))
        db.commit()
    return user


@pytest.fixture()
def org(db_session) -> Organization:
    return _make_org(db_session, "Org A")


@pytest.fixture()
def other_org(db_session) -> Organization:
    return _make_org(db_session, "Org B")


@pytest.fixture()
def user(db_session, org) -> User:
    return _make_user(db_session, org, "admin-a@example.com", "admin")


@pytest.fixture()
def other_user(db_session, other_org) -> User:
    return _make_user(db_session, other_org, "admin-b@example.com", "admin")


def headers_for(user: User, org: Organization) -> dict:
    return {
        "Authorization": f"Bearer {security.create_access_token(user.id)}",
        "X-Org-Id": str(org.id),
    }


@pytest.fixture()
def make_client() -> Generator[Callable[..., TestClient], None, None]:
    """Factory: make_client(user, org) -> TestClient authenticated via Bearer token."""
    app.dependency_overrides[get_db] = _override_get_db
    clients: list[TestClient] = []

    def _factory(user: User | None = None, org: Organization | None = None) -> TestClient:
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        if user is not None:
            c.headers.update(headers_for(user, org) if org else {
                "Authorization": f"Bearer {security.create_access_token(user.id)}"
            })
        return c

    yield _factory
    for c in clients:
        c.__exit__(None, None, None)
    app.dependency_overrides.clear()


@pytest.fixture()
def client(make_client, user, org) -> TestClient:
    """Authenticated as an admin of Org A."""
    return make_client(user, org)


@pytest.fixture()
def other_client(make_client, other_user, other_org) -> TestClient:
    """Authenticated as an admin of Org B."""
    return make_client(other_user, other_org)


@pytest.fixture()
def anon_client(make_client) -> TestClient:
    return make_client()


@pytest.fixture()
def role_client(make_client, db_session, org) -> Callable[[str], TestClient]:
    """Factory: role_client('interviewer') -> client authenticated with that membership role."""

    def _f(role: str) -> TestClient:
        u = _make_user(db_session, org, f"{role}-a@example.com", role)
        return make_client(u, org)

    return _f
