"""Tests for the Role SQLAlchemy model."""
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.role import Role


def test_create_role(db_session):
    """A role can be created with the required fields."""
    role = Role(org_id=1,
        name="Rust Engineer",
        experience_level="Senior",
        experience_required_years=5,
    )
    db_session.add(role)
    db_session.commit()

    assert role.id is not None
    assert role.name == "Rust Engineer"
    assert role.experience_level == "Senior"
    assert role.experience_required_years == 5
    assert isinstance(role.created_at, datetime)


def test_role_name_unique(db_session):
    """Role names must be unique."""
    r1 = Role(org_id=1, name="Engineer", experience_level="Mid", experience_required_years=3)
    db_session.add(r1)
    db_session.commit()

    dup = Role(org_id=1, name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_role_required_fields(db_session):
    """Role requires name, experience_level and experience_required_years."""
    role = Role(org_id=1, name="Intern")
    db_session.add(role)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_role_cascade_delete_candidates(db_session):
    """Deleting a role deletes associated candidates."""
    from app.models.candidate import Candidate

    role = Role(org_id=1, name="ML Engineer", experience_level="Senior", experience_required_years=4)
    db_session.add(role)
    db_session.commit()

    candidate = Candidate(org_id=1, name="Test", email="test@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()

    db_session.delete(role)
    db_session.commit()

    assert db_session.get(Candidate, candidate.id) is None
