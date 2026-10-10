"""Auth flows: register/login/refresh rotation/CSRF/verification/password reset."""

import re

import pytest

from app.core import email as mailer
from app.models.tenancy import RefreshToken, User

PW = "Password123"


def _register(c, email="new@example.com", password=PW):
    return c.post("/auth/register", json={"email": email, "password": password, "full_name": "New U"})


def _csrf(c):
    return {"X-CSRF-Token": c.cookies.get("csrf_token")}


class TestRegisterLogin:
    def test_register_sets_httponly_cookies_and_sends_verification(self, anon_client):
        r = _register(anon_client)
        assert r.status_code == 201
        assert r.json()["user"]["email"] == "new@example.com"
        assert r.json()["user"]["email_verified"] is False
        set_cookie = " ".join(r.headers.get_list("set-cookie")).lower()
        assert "access_token=" in set_cookie and "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert mailer.outbox and "verify" in mailer.outbox[0]["subject"].lower()

    def test_register_duplicate_email(self, anon_client):
        _register(anon_client)
        r = _register(anon_client)
        assert r.status_code == 409 and r.json()["code"] == "email_taken"

    @pytest.mark.parametrize("pw", ["short1", "alllettersnodigits", "1234567890123"])
    def test_weak_passwords_rejected(self, anon_client, pw):
        r = _register(anon_client, password=pw)
        assert r.status_code == 422 and r.json()["code"] == "weak_password"

    def test_login_ok_and_me(self, anon_client, user):
        r = anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        assert r.status_code == 200
        me = anon_client.get("/auth/me")
        assert me.status_code == 200 and me.json()["user"]["email"] == user.email
        assert me.json()["orgs"][0]["role"] == "admin"

    def test_login_wrong_password(self, anon_client, user):
        r = anon_client.post("/auth/login", json={"email": user.email, "password": "nope-nope-1"})
        assert r.status_code == 401 and r.json()["code"] == "invalid_credentials"

    def test_login_unknown_email_looks_identical(self, anon_client):
        r = anon_client.post("/auth/login", json={"email": "ghost@example.com", "password": PW})
        assert r.status_code == 401 and r.json()["code"] == "invalid_credentials"

    def test_login_rate_limited_per_email(self, anon_client, user):
        codes = [
            anon_client.post("/auth/login", json={"email": user.email, "password": "bad-pass-1"}).status_code
            for _ in range(12)
        ]
        assert codes[:10] == [401] * 10
        assert 429 in codes[10:]
        # even the correct password is blocked while limited
        ok = anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        assert ok.status_code == 429


class TestTokens:
    def test_requests_without_token_are_401(self, anon_client):
        r = anon_client.get("/auth/me")
        assert r.status_code == 401 and r.json()["code"] == "not_authenticated"

    def test_garbage_token_is_401(self, anon_client):
        r = anon_client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
        assert r.status_code == 401 and r.json()["code"] == "invalid_token"

    def test_cookie_auth_requires_csrf_on_unsafe_methods(self, anon_client, user, org):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        body = {"name": "R", "experience_level": "Mid", "experience_required_years": 2}
        h = {"X-Org-Id": str(org.id)}
        assert anon_client.get("/roles/", headers=h).status_code == 200  # safe method: no CSRF
        no_csrf = anon_client.post("/roles/", json=body, headers=h)
        assert no_csrf.status_code == 403 and no_csrf.json()["code"] == "csrf_failed"
        with_csrf = anon_client.post("/roles/", json=body, headers={**h, **_csrf(anon_client)})
        assert with_csrf.status_code == 200

    def test_bearer_auth_skips_csrf(self, client):
        body = {"name": "R", "experience_level": "Mid", "experience_required_years": 2}
        assert client.post("/roles/", json=body).status_code == 200

    def test_refresh_rotates_and_old_token_reuse_revokes_family(self, anon_client, user, db_session):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        old_refresh = anon_client.cookies.get("refresh_token")

        r = anon_client.post("/auth/refresh", headers=_csrf(anon_client))
        assert r.status_code == 200
        new_refresh = anon_client.cookies.get("refresh_token")
        assert new_refresh and new_refresh != old_refresh

        # Replaying the rotated-out token is treated as theft
        anon_client.cookies.set("refresh_token", old_refresh, path="/auth")
        replay = anon_client.post("/auth/refresh", headers=_csrf(anon_client))
        assert replay.status_code == 401 and replay.json()["code"] == "token_reuse"
        live = db_session.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count()
        assert live == 0

    def test_refresh_requires_csrf(self, anon_client, user):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        assert anon_client.post("/auth/refresh").status_code == 403

    def test_logout_revokes_refresh_token(self, anon_client, user, db_session):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        refresh = anon_client.cookies.get("refresh_token")
        assert anon_client.post("/auth/logout").status_code == 204
        anon_client.cookies.set("refresh_token", refresh, path="/auth")
        r = anon_client.post("/auth/refresh", headers={"X-CSRF-Token": "x"})
        assert r.status_code in (401, 403)
        assert db_session.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0

    def test_refresh_tokens_are_stored_hashed(self, anon_client, user, db_session):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        raw = anon_client.cookies.get("refresh_token")
        assert all(raw != t.token_hash for t in db_session.query(RefreshToken))


class TestEmailFlows:
    def test_verify_email(self, anon_client, db_session):
        _register(anon_client)
        token = re.search(r"token=(\S+)", mailer.outbox[0]["text"]).group(1)
        r = anon_client.post("/auth/verify-email", json={"token": token})
        assert r.status_code == 200 and r.json()["email_verified"] is True

    def test_verify_email_bad_token(self, anon_client):
        r = anon_client.post("/auth/verify-email", json={"token": "garbage"})
        assert r.status_code == 400 and r.json()["code"] == "invalid_token"

    def test_password_reset_flow_is_single_use(self, anon_client, user):
        assert anon_client.post("/auth/forgot-password", json={"email": user.email}).status_code == 202
        token = re.search(r"token=(\S+)", mailer.outbox[-1]["text"]).group(1)

        assert anon_client.post("/auth/reset-password", json={"token": token, "password": "BrandNew12345"}).status_code == 204
        assert anon_client.post("/auth/login", json={"email": user.email, "password": "BrandNew12345"}).status_code == 200
        # reusing the same link fails
        again = anon_client.post("/auth/reset-password", json={"token": token, "password": "Another12345"})
        assert again.status_code == 400

    def test_forgot_password_does_not_reveal_unknown_accounts(self, anon_client):
        r = anon_client.post("/auth/forgot-password", json={"email": "ghost@example.com"})
        assert r.status_code == 202 and not mailer.outbox

    def test_password_reset_revokes_sessions(self, anon_client, user, db_session):
        anon_client.post("/auth/login", json={"email": user.email, "password": PW})
        anon_client.post("/auth/forgot-password", json={"email": user.email})
        token = re.search(r"token=(\S+)", mailer.outbox[-1]["text"]).group(1)
        anon_client.post("/auth/reset-password", json={"token": token, "password": "BrandNew12345"})
        assert db_session.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0


def test_passwords_are_hashed_with_argon2(user, db_session):
    row = db_session.query(User).filter(User.id == user.id).one()
    assert row.password_hash.startswith("$argon2")


def test_oauth_unconfigured_provider_returns_501(anon_client):
    r = anon_client.get("/auth/oauth/google/login", follow_redirects=False)
    assert r.status_code == 501 and r.json()["code"] == "oauth_not_configured"


def test_oauth_unknown_provider_404(anon_client):
    assert anon_client.get("/auth/oauth/github/login").status_code == 404
