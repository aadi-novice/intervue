"""Tests for the ResumeProfile SQLAlchemy model."""
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.candidate import Candidate
from app.models.resume_profile import ResumeProfile
from app.models.role import Role


def _create_candidate(db_session) -> Candidate:
    role = Role(org_id=1, name="Engineer", experience_level="Senior", experience_required_years=5)
    db_session.add(role)
    db_session.commit()
    candidate = Candidate(org_id=1, name="Test User", email="test@example.com", role_id=role.id)
    db_session.add(candidate)
    db_session.commit()
    return candidate


def test_create_resume_profile(db_session):
    """A resume profile can be created with all required fields."""
    candidate = _create_candidate(db_session)

    profile = ResumeProfile(org_id=1,
        candidate_id=candidate.id,
        basics={"full_name": "Test User", "email": "test@example.com"},
        summary="A summary",
        education=[{"institution": "MIT", "degree": "BS"}],
        experience=[{"company": "Acme", "designation": "Engineer"}],
        projects=[{"name": "Project X"}],
        skills={"programming_languages": ["Python"]},
        metadata_={"resume_pages": 1, "total_experience_years": 5},
    )
    db_session.add(profile)
    db_session.commit()

    assert profile.id is not None
    assert profile.basics["full_name"] == "Test User"
    assert profile.candidate_id == candidate.id
    assert isinstance(profile.created_at, datetime)


def test_resume_profile_unique_per_candidate(db_session):
    """A candidate can only have one resume profile."""
    candidate = _create_candidate(db_session)

    common = dict(
        basics={"name": "X"},
        summary="S",
        education=[],
        experience=[],
        projects=[],
        skills={"languages": []},
        metadata_={"pages": 1},
    )

    p1 = ResumeProfile(org_id=1, candidate_id=candidate.id, **common)
    db_session.add(p1)
    db_session.commit()

    dup = ResumeProfile(org_id=1, candidate_id=candidate.id, **common)
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_resume_profile_relationship(db_session):
    """ResumeProfile links back to candidate."""
    candidate = _create_candidate(db_session)

    profile = ResumeProfile(org_id=1,
        candidate_id=candidate.id,
        basics={"full_name": "Test"},
        summary="S",
        education=[],
        experience=[],
        projects=[],
        skills={"languages": []},
        metadata_={"pages": 1},
    )
    db_session.add(profile)
    db_session.commit()

    assert profile.candidate.name == "Test User"
    assert candidate.resume_profile.summary == "S"
