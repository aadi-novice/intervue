"""Tenancy: every protected route needs auth; users never see other orgs' data; role guards."""

import re

import pytest
from fastapi.routing import APIRoute

from app.api.deps import get_org_context
from app.main import app
from app.core import email as mailer
from app.models.analysis import Analysis
from app.models.tenancy import AuditLog
from tests.factories import make_candidate, make_role

PUBLIC = {
    "/",
    "/healthz",
    "/readyz",
    "/auth/register",
    "/auth/login",
    "/auth/refresh",
    "/auth/logout",
    "/auth/verify-email",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/oauth/{provider}/login",
    "/auth/oauth/{provider}/callback",
    # calendar: browser redirect target (identity comes from signed state) and provider webhooks
    "/calendar/oauth/{provider}/callback",
    "/webhooks/calendar/google",
    "/webhooks/calendar/microsoft",
}


def _protected_routes():
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path not in PUBLIC:
            for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
                yield m, r.path


def _fill(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


@pytest.mark.parametrize("method,path", list(_protected_routes()))
def test_every_protected_route_requires_auth(anon_client, method, path):
    r = anon_client.request(method, _fill(path), json={})
    assert r.status_code == 401, f"{method} {path} returned {r.status_code}"


def _uses_org_context(dependant) -> bool:
    return any(
        d.call is get_org_context or _uses_org_context(d) for d in dependant.dependencies
    )


def _org_scoped_routes():
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path not in PUBLIC and _uses_org_context(r.dependant):
            for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
                yield m, r.path


@pytest.mark.parametrize("method,path", list(_org_scoped_routes()))
def test_org_routes_require_org_header_and_membership(make_client, user, other_org, method, path):
    c = make_client(user)  # authenticated, no X-Org-Id
    if "{org_id}" not in path:
        assert c.request(method, _fill(path), json={}).status_code == 400
    # a real org the user does NOT belong to -> 403
    c.headers["X-Org-Id"] = str(other_org.id)
    target = path.replace("{org_id}", str(other_org.id))
    assert c.request(method, _fill(target), json={}).status_code == 403


class TestCrossTenantIsolation:
    """User A must never read, modify or delete org B's data."""

    @pytest.fixture()
    def b_data(self, db_session, other_org):
        role = make_role(db_session, other_org.id, "B Role")
        cand = make_candidate(
            db_session, other_org.id, role.id, "b@example.com", resume_path="2/resumes/x.pdf"
        )
        db_session.add(
            Analysis(
                org_id=other_org.id, candidate_id=cand.id, summary="secret", strengths=[],
                weaknesses=[], technical_score=1, communication_score=1, confidence_score=1,
            )
        )
        db_session.commit()
        return role, cand

    def test_lists_do_not_leak(self, client, b_data):
        assert client.get("/roles/").json() == []
        assert client.get("/candidates/").json() == []

    def test_detail_reads_404(self, client, b_data):
        role, cand = b_data
        assert client.get(f"/roles/{role.id}").status_code == 404
        assert client.get(f"/candidates/{cand.id}").status_code == 404
        assert client.get(f"/candidates/role/{role.id}").json() == []
        assert client.get(f"/candidates/{cand.id}/resume-text").status_code == 404
        assert client.get(f"/candidates/{cand.id}/transcript-chunks").status_code == 404

    def test_writes_404_and_change_nothing(self, client, other_client, b_data, db_session):
        role, cand = b_data
        assert client.patch(f"/candidates/{cand.id}/status", json={"status": "hired"}).status_code == 404
        assert client.patch(f"/roles/{role.id}", json={"status": "closed"}).status_code == 404
        assert client.delete(f"/candidates/{cand.id}").status_code == 404
        assert client.delete(f"/roles/{role.id}").status_code == 404
        # still intact for the owner
        assert other_client.get(f"/candidates/{cand.id}").json()["stage"] == "applied"
        assert other_client.get(f"/roles/{role.id}").json()["status"] == "open"

    def test_cannot_create_candidate_on_other_orgs_role(self, client, b_data):
        role, _ = b_data
        r = client.post("/candidates/", json={"name": "X", "email": "x@example.com", "role_id": role.id})
        assert r.status_code == 404

    def test_forged_org_header_is_rejected(self, client, other_org, b_data):
        r = client.get("/roles/", headers={"X-Org-Id": str(other_org.id)})
        assert r.status_code == 403 and r.json()["code"] == "wrong_org"

    def test_same_email_can_exist_in_two_orgs(self, client, other_client, db_session, org, other_org):
        role_a = make_role(db_session, org.id, "A Role")
        role_b = make_role(db_session, other_org.id, "B Role 2")
        body = {"name": "Dup", "email": "dup@example.com"}
        assert client.post("/candidates/", json={**body, "role_id": role_a.id}).status_code == 200
        assert other_client.post("/candidates/", json={**body, "role_id": role_b.id}).status_code == 200
        r = client.post("/candidates/", json={**body, "role_id": role_a.id})
        assert r.status_code == 409 and r.json()["code"] == "candidate_exists"


class TestRoleGuards:
    def test_interviewer_cannot_manage_roles_or_candidates(self, role_client, db_session, org):
        role = make_role(db_session, org.id)
        c = role_client("interviewer")
        body = {"name": "N", "experience_level": "Mid", "experience_required_years": 1}
        assert c.post("/roles/", json=body).status_code == 403
        assert c.delete(f"/roles/{role.id}").status_code == 403
        assert c.post("/candidates/", json={"name": "A", "email": "a@x.com", "role_id": role.id}).status_code == 403

    def test_interviewer_only_sees_candidates_they_interview(self, role_client, db_session, org):
        from app.models.interview import Interview, InterviewParticipant

        role = make_role(db_session, org.id)
        mine = make_candidate(db_session, org.id, role.id, "mine@x.com")
        other = make_candidate(db_session, org.id, role.id, "other@x.com")
        c = role_client("interviewer")
        me = c.get("/auth/me").json()["user"]["id"]
        iv = Interview(org_id=org.id, candidate_id=mine.id, title="Round 1")
        db_session.add(iv)
        db_session.flush()
        db_session.add(
            InterviewParticipant(interview_id=iv.id, user_id=me, display_name="Me", kind="interviewer")
        )
        db_session.commit()

        ids = [x["id"] for x in c.get("/candidates/").json()]
        assert ids == [str(mine.id)]
        assert c.get(f"/candidates/{other.id}").status_code == 404

    def test_hiring_manager_can_move_stage_but_not_create(self, role_client, db_session, org):
        role = make_role(db_session, org.id)
        cand = make_candidate(db_session, org.id, role.id)
        c = role_client("hiring_manager")
        assert c.patch(f"/candidates/{cand.id}/status", json={"status": "offer"}).status_code == 200
        assert c.post("/candidates/", json={"name": "A", "email": "a@x.com", "role_id": role.id}).status_code == 403

    def test_recruiter_can_create_roles_and_candidates(self, role_client, db_session, org):
        c = role_client("recruiter")
        r = c.post("/roles/", json={"name": "N", "experience_level": "Mid", "experience_required_years": 1})
        assert r.status_code == 200
        assert c.post("/candidates/", json={"name": "A", "email": "a@x.com", "role_id": r.json()["id"]}).status_code == 200


class TestOrgsAndMembers:
    def test_create_org_makes_creator_admin(self, anon_client):
        anon_client.post("/auth/register", json={"email": "founder@example.com", "password": "Password123", "full_name": "F"})
        r = anon_client.post("/orgs", json={"name": "Acme Corp"}, headers={"X-CSRF-Token": anon_client.cookies.get("csrf_token")})
        assert r.status_code == 201 and r.json()["role"] == "admin" and r.json()["slug"] == "acme-corp"
        again = anon_client.post("/orgs", json={"name": "Acme Corp"}, headers={"X-CSRF-Token": anon_client.cookies.get("csrf_token")})
        assert again.json()["slug"] == "acme-corp-2"
        assert len(anon_client.get("/orgs/me").json()) == 2

    def test_invite_accept_flow(self, client, org, make_client, db_session):
        r = client.post(f"/orgs/{org.id}/invitations", json={"email": "newbie@example.com", "role": "recruiter"})
        assert r.status_code == 201
        token = re.search(r"token=(\S+)", mailer.outbox[-1]["text"]).group(1)

        newbie_client = make_client()
        newbie_client.post("/auth/register", json={"email": "newbie@example.com", "password": "Password123", "full_name": "N"})
        csrf = {"X-CSRF-Token": newbie_client.cookies.get("csrf_token")}
        ok = newbie_client.post("/orgs/invitations/accept", json={"token": token}, headers=csrf)
        assert ok.status_code == 200 and ok.json()["role"] == "recruiter"
        again = newbie_client.post("/orgs/invitations/accept", json={"token": token}, headers=csrf)
        assert again.status_code == 400

    def test_invitation_bound_to_email(self, client, org, make_client):
        client.post(f"/orgs/{org.id}/invitations", json={"email": "target@example.com", "role": "interviewer"})
        token = re.search(r"token=(\S+)", mailer.outbox[-1]["text"]).group(1)
        thief = make_client()
        thief.post("/auth/register", json={"email": "thief@example.com", "password": "Password123", "full_name": "T"})
        r = thief.post("/orgs/invitations/accept", json={"token": token}, headers={"X-CSRF-Token": thief.cookies.get("csrf_token")})
        assert r.status_code == 403 and r.json()["code"] == "wrong_email"

    def test_only_admin_can_invite_and_change_settings(self, role_client, org):
        c = role_client("recruiter")
        assert c.post(f"/orgs/{org.id}/invitations", json={"email": "a@x.com", "role": "interviewer"}).status_code == 403
        assert c.patch(f"/orgs/{org.id}/settings", json={"blind_review": True}).status_code == 403
        assert c.get(f"/orgs/{org.id}/members").status_code == 200

    def test_cannot_remove_last_admin(self, client, org, user):
        r = client.delete(f"/orgs/{org.id}/members/{user.id}")
        assert r.status_code == 409 and r.json()["code"] == "last_admin"

    def test_org_path_id_is_checked_against_membership(self, client, other_org):
        assert client.get(f"/orgs/{other_org.id}/members").status_code == 403

    def test_settings_update_whitelists_keys(self, client, org):
        r = client.patch(f"/orgs/{org.id}/settings", json={"blind_review": True, "seed_color": "#112233", "consent_message": "We record this call for notes."})
        assert r.status_code == 200
        s = r.json()["settings"]
        assert s["blind_review"] is True and s["seed_color"] == "#112233"
        assert client.patch(f"/orgs/{org.id}/settings", json={"seed_color": "red"}).status_code == 422


class TestAudit:
    def test_candidate_lifecycle_is_audited(self, client, db_session, org):
        role = make_role(db_session, org.id)
        cid = client.post("/candidates/", json={"name": "A", "email": "a@x.com", "role_id": role.id}).json()["id"]
        client.get(f"/candidates/{cid}")
        client.delete(f"/candidates/{cid}")
        actions = [a.action for a in db_session.query(AuditLog).filter(AuditLog.org_id == org.id)]
        assert actions == ["candidate.created", "candidate.viewed", "candidate.deleted"]

    def test_member_changes_are_audited(self, client, org):
        client.post(f"/orgs/{org.id}/invitations", json={"email": "z@x.com", "role": "interviewer"})
        from tests.conftest import TestSessionLocal

        db = TestSessionLocal()
        try:
            assert db.query(AuditLog).filter(AuditLog.action == "member.invited").count() == 1
        finally:
            db.close()
