"""Tests for the /candidates API endpoints."""


def _create_role(client, name: str = "Engineer") -> int:
    resp = client.post("/roles/", json={
        "name": name,
        "experience_level": "Senior",
        "experience_required_years": 5,
    })
    return resp.json()["id"]


class TestCreateCandidate:
    def test_create_candidate(self, client):
        role_id = _create_role(client)

        payload = {
            "name": "Alice Smith",
            "email": "alice@example.com",
            "phone": "+1-555-0100",
            "role_id": role_id,
        }
        response = client.post("/candidates/", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Alice Smith"
        assert data["email"] == "alice@example.com"
        assert data["phone"] == "+1-555-0100"
        assert data["status"] == "applied"
        assert "id" in data

    def test_create_candidate_invalid_email(self, client):
        role_id = _create_role(client)
        payload = {"name": "Bad", "email": "not-email", "role_id": role_id}
        response = client.post("/candidates/", json=payload)
        assert response.status_code == 422

    def test_create_candidate_no_role(self, client):
        payload = {
            "name": "Ghost",
            "email": "ghost@example.com",
            "role_id": 9999,
        }
        response = client.post("/candidates/", json=payload)
        assert response.status_code == 404
        assert "role not found" in response.json()["detail"].lower()

    def test_create_candidate_without_phone(self, client):
        role_id = _create_role(client)
        payload = {"name": "Bob", "email": "bob@example.com", "role_id": role_id}
        response = client.post("/candidates/", json=payload)
        assert response.status_code == 200
        assert response.json()["phone"] is None


class TestListCandidates:
    def test_empty_list(self, client):
        response = client.get("/candidates/")
        assert response.status_code == 200
        assert response.json() == []

    def test_list_candidates(self, client):
        role_id = _create_role(client)
        client.post("/candidates/", json={
            "name": "Alice", "email": "alice@example.com", "role_id": role_id,
        })
        client.post("/candidates/", json={
            "name": "Bob", "email": "bob@example.com", "role_id": role_id,
        })

        response = client.get("/candidates/")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

        # Pipeline response fields
        assert data[0]["name"] in ("Alice", "Bob")
        assert data[0]["role"] == "Engineer"
        assert "avatar" in data[0]
        assert "color" in data[0]
        assert "days" in data[0]
        assert "score" in data[0]
        assert "stage" in data[0]
        assert data[0]["ai"] is False


class TestUpdateStatus:
    def test_update_status(self, client):
        role_id = _create_role(client)
        create_resp = client.post("/candidates/", json={
            "name": "Alice", "email": "alice@example.com", "role_id": role_id,
        })
        candidate_id = create_resp.json()["id"]

        new_status = "interview"
        response = client.patch(
            f"/candidates/{candidate_id}/status",
            json={"status": new_status},
        )
        assert response.status_code == 200
        assert response.json()["status"] == new_status

    def test_update_status_invalid(self, client):
        role_id = _create_role(client)
        create_resp = client.post("/candidates/", json={
            "name": "Bob", "email": "bob@example.com", "role_id": role_id,
        })
        candidate_id = create_resp.json()["id"]

        response = client.patch(
            f"/candidates/{candidate_id}/status",
            json={"status": "nonexistent"},
        )
        assert response.status_code == 422  # Validation error

    def test_update_status_not_found(self, client):
        response = client.patch(
            "/candidates/9999/status",
            json={"status": "applied"},
        )
        assert response.status_code == 404


class TestDeleteCandidate:
    def test_delete_candidate(self, client):
        role_id = _create_role(client)
        create_resp = client.post("/candidates/", json={
            "name": "Delete Me", "email": "delete@example.com", "role_id": role_id,
        })
        candidate_id = create_resp.json()["id"]

        response = client.delete(f"/candidates/{candidate_id}")
        assert response.status_code == 204

        # Verify it's gone
        list_resp = client.get("/candidates/")
        assert len(list_resp.json()) == 0

    def test_delete_nonexistent(self, client):
        response = client.delete("/candidates/9999")
        assert response.status_code == 404


class TestGetCandidateDetail:
    def test_get_detail(self, client):
        role_id = _create_role(client, "Rust Engineer")
        create_resp = client.post("/candidates/", json={
            "name": "Alice Smith",
            "email": "alice@example.com",
            "role_id": role_id,
        })
        candidate_id = create_resp.json()["id"]

        response = client.get(f"/candidates/{candidate_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Alice Smith"
        assert data["role"] == "Rust Engineer"
        assert data["stage"] == "applied"
        assert data["analysis"] is None
        assert data["resume_profile"] is None
        assert "avatar" in data
        assert "id" in data

    def test_get_detail_not_found(self, client):
        response = client.get("/candidates/9999")
        assert response.status_code == 404


class TestGetCandidatesByRole:
    def test_get_by_role(self, client):
        role_a = _create_role(client, "Role A")
        role_b = _create_role(client, "Role B")

        client.post("/candidates/", json={
            "name": "Alice", "email": "alice@example.com", "role_id": role_a,
        })
        client.post("/candidates/", json={
            "name": "Bob", "email": "bob@example.com", "role_id": role_a,
        })
        client.post("/candidates/", json={
            "name": "Charlie", "email": "charlie@example.com", "role_id": role_b,
        })

        response = client.get(f"/candidates/role/{role_a}")
        assert response.status_code == 200
        assert len(response.json()) == 2

        response = client.get(f"/candidates/role/{role_b}")
        assert len(response.json()) == 1
