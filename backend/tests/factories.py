"""Small helpers for creating rows directly in tests."""

from app.models.candidate import Candidate
from app.models.role import Role


def make_role(db, org_id: int, name: str = "Engineer", **kw) -> Role:
    role = Role(
        org_id=org_id,
        name=name,
        experience_level=kw.pop("experience_level", "Senior"),
        experience_required_years=kw.pop("experience_required_years", 5),
        **kw,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def make_candidate(
    db, org_id: int, role_id: int, email: str = "alice@example.com", **kw
) -> Candidate:
    cand = Candidate(
        org_id=org_id, name=kw.pop("name", "Alice"), email=email, role_id=role_id, **kw
    )
    db.add(cand)
    db.commit()
    db.refresh(cand)
    return cand
