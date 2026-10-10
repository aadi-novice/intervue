"""Tests for the /roles API endpoints."""


class TestCreateRole:
    def test_create_role(self, client):
        payload = {
            "name": "Rust Engineer",
            "experience_level": "Senior",
            "experience_required_years": 5,
        }
        response = client.post("/roles/", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Rust Engineer"
        assert data["experience_level"] == "Senior"
        assert data["experience_required_years"] == 5
        assert "id" in data
        assert "created_at" in data

    def test_create_role_missing_fields(self, client):
        response = client.post("/roles/", json={})
        assert response.status_code == 422  # Validation error

    def test_create_duplicate_role_conflicts(self, client):
        payload = {
            "name": "Unique Role",
            "experience_level": "Mid",
            "experience_required_years": 3,
        }
        assert client.post("/roles/", json=payload).status_code == 200
        response = client.post("/roles/", json=payload)
        assert response.status_code == 409
        assert response.json()["code"] == "role_exists"

    def test_same_role_name_allowed_in_different_orgs(self, client, other_client):
        payload = {"name": "Shared Name", "experience_level": "Mid", "experience_required_years": 3}
        assert client.post("/roles/", json=payload).status_code == 200
        assert other_client.post("/roles/", json=payload).status_code == 200


class TestListRoles:
    def test_empty_list(self, client):
        response = client.get("/roles/")
        assert response.status_code == 200
        assert response.json() == []

    def test_list_roles(self, client):
        client.post("/roles/", json={
            "name": "Engineer A",
            "experience_level": "Senior",
            "experience_required_years": 5,
        })
        client.post("/roles/", json={
            "name": "Engineer B",
            "experience_level": "Junior",
            "experience_required_years": 1,
        })
        response = client.get("/roles/")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["name"] == "Engineer A"
        assert data[1]["name"] == "Engineer B"


class TestDeleteRole:
    def test_delete_role(self, client):
        create_resp = client.post("/roles/", json={
            "name": "Delete Me",
            "experience_level": "Intern",
            "experience_required_years": 0,
        })
        role_id = create_resp.json()["id"]

        response = client.delete(f"/roles/{role_id}")
        assert response.status_code == 204

        # Verify it's gone
        list_resp = client.get("/roles/")
        assert len(list_resp.json()) == 0

    def test_delete_nonexistent_role(self, client):
        response = client.delete("/roles/9999")
        assert response.status_code == 404

    def test_delete_role_with_candidates(self, client):
        """Deleting a role that has candidates should return 409."""
        # Create role
        role_resp = client.post("/roles/", json={
            "name": "Has Candidates",
            "experience_level": "Senior",
            "experience_required_years": 5,
        })
        role_id = role_resp.json()["id"]

        # Create candidate under this role
        client.post("/candidates/", json={
            "name": "Test User",
            "email": "test@example.com",
            "role_id": role_id,
        })

        # Try to delete role
        response = client.delete(f"/roles/{role_id}")
        assert response.status_code == 409
        assert "candidate" in response.json()["detail"].lower()
