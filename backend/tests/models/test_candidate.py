"""Tests for the Candidate SQLAlchemy model."""
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.candidate import Candidate
from app.models.role import Role


def test_create_candidate(db_session):
    """A candidate can be created with the required fields."""
    role = Role(org_id=1, name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1,
        name="Alice Smith",
        email="alice@example.com",
        phone="+1-555-0100",
        role_id=role.id,
        status="applied",
    )
    db_session.add(candidate)
    db_session.commit()

    assert candidate.id is not None
    assert candidate.name == "Alice Smith"
    assert candidate.email == "alice@example.com"
    assert candidate.phone == "+1-555-0100"
    assert candidate.status == "applied"
    assert candidate.role_id == role.id
    assert isinstance(candidate.created_at, datetime)


def test_candidate_default_status(db_session):
    """A candidate's default status should be 'applied'."""
    role = Role(org_id=1, name="Designer", experience_level="Mid", experience_required_years=3)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1, name="Bob", email="bob@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()

    assert candidate.status == "applied"


def test_candidate_unique_email(db_session):
    """Candidate email must be unique."""
    role = Role(org_id=1, name="PM", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()

    c1 = Candidate(org_id=1, name="User A", email="dup@example.com", role_id=role.id)
    db_session.add(c1)
    db_session.commit()

    dup = Candidate(org_id=1, name="User B", email="dup@example.com", role_id=role.id)
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_candidate_role_relationship(db_session):
    """A candidate belongs to a role."""
    role = Role(org_id=1, name="Data Scientist", experience_level="Senior", experience_required_years=4)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1, name="Charlie", email="charlie@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()

    assert candidate.role.name == "Data Scientist"
    assert role.candidates[0].name == "Charlie"


def test_candidate_nullable_fields(db_session):
    """Phone, resume_path, transcript_path, and avatar_path are nullable."""
    role = Role(org_id=1, name="DevOps", experience_level="Mid", experience_required_years=3)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1, name="Diana", email="diana@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()

    assert candidate.phone is None
    assert candidate.resume_path is None
    assert candidate.transcript_path is None
    assert candidate.avatar_path is None


def test_candidate_cascade_delete(db_session):
    """Deleting a role should cascade delete its candidates."""
    role = Role(org_id=1, name="QA", experience_level="Junior", experience_required_years=1)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1, name="Eve", email="eve@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()

    db_session.delete(role)
    db_session.commit()

    assert db_session.get(Candidate, candidate.id) is None
