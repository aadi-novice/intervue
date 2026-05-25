"""Tests for the role Pydantic schemas."""
import pytest
from pydantic import ValidationError

from app.schemas.role import RoleCreate, RoleResponse


class TestRoleCreate:
    def test_valid_input(self):
        data = RoleCreate(
            name="Rust Engineer",
            experience_level="Senior",
            experience_required_years=5,
        )
        assert data.name == "Rust Engineer"
        assert data.experience_level == "Senior"
        assert data.experience_required_years == 5

    def test_missing_required_fields(self):
        with pytest.raises(ValidationError):
            RoleCreate()


class TestRoleResponse:
    def test_from_attributes(self):
        data = RoleResponse.model_validate({
            "id": 1,
            "name": "Engineer",
            "experience_level": "Mid",
            "experience_required_years": 3,
            "created_at": "2025-01-01T00:00:00",
        })
        assert data.name == "Engineer"
        assert data.experience_required_years == 3
