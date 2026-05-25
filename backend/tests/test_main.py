"""Tests for the FastAPI application entry point."""


def test_root_endpoint(client):
    """GET / should return the welcome message."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Intervue backend running"


def test_app_title(client):
    """The OpenAPI schema should contain the correct title."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Intervue API"
