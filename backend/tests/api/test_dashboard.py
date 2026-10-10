"""Dashboard summary, org usage, candidate activity, pipeline enrichment."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.models.ai_run import AIRun
from app.models.analysis import Analysis
from app.models.job import Job
from app.models.rubric import RoleMatch
from tests.factories import make_candidate, make_interview, make_role


@pytest.fixture()
def role(db_session, org):
    return make_role(db_session, org.id, "Rust Engineer")


def run(db, org, purpose="analysis", cost="0.5", status="ok", when=None):
    r = AIRun(org_id=org.id, purpose=purpose, model="m", prompt_version="v", status=status,
              input_tokens=100, output_tokens=50, cost_usd=Decimal(cost))
    db.add(r)
    db.commit()
    if when:
        r.created_at = when
        db.commit()
    return r


class TestSummary:
    def test_open_roles_with_ranking_progress(self, client, db_session, org, role):
        closed = make_role(db_session, org.id, "Closed", status="closed")
        c1 = make_candidate(db_session, org.id, role.id, "a@x.com")
        c2 = make_candidate(db_session, org.id, role.id, "b@x.com")
        db_session.add_all([
            RoleMatch(org_id=org.id, candidate_id=c1.id, role_id=role.id, status="scored", overall_score=80.0),
            RoleMatch(org_id=org.id, candidate_id=c2.id, role_id=role.id, status="scored", overall_score=60.0),
            Job(org_id=org.id, kind="rank", entity_type="role", entity_id=role.id, status="completed"),
        ])
        db_session.commit()
        roles = client.get("/dashboard/summary").json()["roles"]
        assert [r["name"] for r in roles] == ["Rust Engineer"] and closed.id not in [r["id"] for r in roles]
        assert (roles[0]["candidate_count"], roles[0]["scored_count"], roles[0]["avg_score"], roles[0]["rank_status"]) == (2, 2, 70.0, "completed")

    def test_upcoming_interviews_window_and_status(self, client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id)
        now = datetime.now(UTC)
        make_interview(db_session, org.id, cand, title="soon", scheduled_start=now + timedelta(days=1))
        make_interview(db_session, org.id, cand, title="far", scheduled_start=now + timedelta(days=30))
        make_interview(db_session, org.id, cand, title="past", scheduled_start=now - timedelta(days=2))
        make_interview(db_session, org.id, cand, title="cancelled", scheduled_start=now + timedelta(days=2), status="cancelled")
        ups = client.get("/dashboard/summary").json()["upcoming_interviews"]
        assert [u["title"] for u in ups] == ["soon"]

    def test_recent_analyses_newest_first_and_capped(self, client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id, name="Alice Doe")
        for i in range(7):
            db_session.add(Analysis(org_id=org.id, candidate_id=cand.id, role_id=role.id, summary="s", strengths=[],
                                    weaknesses=[], technical_score=60 + i, communication_score=60 + i,
                                    confidence_score=60 + i, hiring_recommendation="Hire"))
        db_session.commit()
        recent = client.get("/dashboard/summary").json()["recent_analyses"]
        assert len(recent) == 5 and recent[0]["aggregate"] == 66 and recent[0]["candidate"]["name"] == "Alice Doe"
        assert recent[0]["role_name"] == "Rust Engineer"

    def test_recent_analyses_respect_blind_review(self, client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id, name="Alice Doe")
        db_session.add(Analysis(org_id=org.id, candidate_id=cand.id, summary="s", strengths=[], weaknesses=[],
                                technical_score=1, communication_score=1, confidence_score=1))
        db_session.commit()
        client.patch(f"/orgs/{org.id}/settings", json={"blind_review": True})
        c = client.get("/dashboard/summary").json()["recent_analyses"][0]["candidate"]
        assert c["blind"] is True and "Alice" not in c["name"] and c["email"] is None

    def test_ai_cost_is_admin_only_and_current_month_only(self, client, role_client, db_session, org):
        run(db_session, org, cost="1.25")
        run(db_session, org, cost="2.00", when=datetime.now(UTC) - timedelta(days=62))
        assert client.get("/dashboard/summary").json()["ai_cost_month_usd"] == 1.25
        assert role_client("recruiter").get("/dashboard/summary").json()["ai_cost_month_usd"] is None

    def test_isolation_between_orgs(self, other_client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id)
        db_session.add(Analysis(org_id=org.id, candidate_id=cand.id, summary="s", strengths=[], weaknesses=[],
                                technical_score=1, communication_score=1, confidence_score=1))
        db_session.commit()
        s = other_client.get("/dashboard/summary").json()
        assert s["roles"] == [] and s["recent_analyses"] == [] and s["upcoming_interviews"] == []

    def test_interviewer_sees_no_analyses_and_only_own_interviews(self, role_client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id)
        make_interview(db_session, org.id, cand, scheduled_start=datetime.now(UTC) + timedelta(days=1))
        db_session.add(Analysis(org_id=org.id, candidate_id=cand.id, summary="s", strengths=[], weaknesses=[],
                                technical_score=1, communication_score=1, confidence_score=1))
        db_session.commit()
        s = role_client("interviewer").get("/dashboard/summary").json()
        assert s["recent_analyses"] == [] and s["upcoming_interviews"] == []


class TestUsage:
    def test_groups_by_purpose_excludes_cached_and_old_runs(self, client, db_session, org):
        run(db_session, org, "rank", "1.00")
        run(db_session, org, "rank", "0.50")
        run(db_session, org, "analysis", "0.25")
        run(db_session, org, "analysis", "9.99", status="cached")
        run(db_session, org, "rank", "5.00", when=datetime.now(UTC) - timedelta(days=62))
        u = client.get(f"/orgs/{org.id}/usage").json()
        assert u["total_usd"] == 1.75
        assert [(p["purpose"], p["runs"], p["cost_usd"]) for p in u["by_purpose"]] == [("rank", 2, 1.5), ("analysis", 1, 0.25)]
        assert u["by_purpose"][0]["input_tokens"] == 200

    def test_admin_only_and_org_scoped(self, role_client, other_client, org):
        assert role_client("recruiter").get(f"/orgs/{org.id}/usage").status_code == 403
        assert other_client.get(f"/orgs/{org.id}/usage").status_code == 403


class TestActivity:
    def test_lists_audit_entries_for_the_candidate_newest_first(self, client, db_session, org, role):
        cid = client.post("/candidates/", json={"name": "A", "email": "a@x.com", "role_id": role.id}).json()["id"]
        client.get(f"/candidates/{cid}")
        items = client.get(f"/candidates/{cid}/activity").json()
        assert [i["action"] for i in items][:2] == ["candidate.viewed", "candidate.created"]
        assert items[0]["user_name"]

    def test_scoping_and_roles(self, client, other_client, role_client, db_session, org, role):
        cand = make_candidate(db_session, org.id, role.id)
        assert other_client.get(f"/candidates/{cand.id}/activity").status_code == 404
        assert role_client("interviewer").get(f"/candidates/{cand.id}/activity").status_code == 403
        assert role_client("hiring_manager").get(f"/candidates/{cand.id}/activity").status_code == 200


class TestPipelineEnrichment:
    def test_source_interviewed_and_best_match(self, client, db_session, org, role):
        other = make_role(db_session, org.id, "Sales Lead")
        cand = make_candidate(db_session, org.id, role.id, source="bulk")
        make_interview(db_session, org.id, cand)
        db_session.add_all([
            RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=role.id, status="scored", overall_score=55.0, vector_similarity=0.5),
            RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=other.id, status="scored", overall_score=82.0, vector_similarity=0.3),
        ])
        db_session.commit()
        item = client.get("/candidates/").json()[0]
        assert item["source"] == "bulk" and item["interviewed"] is True
        assert item["best_match"]["role_name"] == "Sales Lead" and item["best_match"]["score"] == 82.0

    def test_unmatched_candidate_has_no_best_match(self, client, db_session, org, role):
        make_candidate(db_session, org.id, role.id)
        item = client.get("/candidates/").json()[0]
        assert item["best_match"] is None and item["interviewed"] is False

    def test_closed_roles_are_ignored(self, client, db_session, org, role):
        closed = make_role(db_session, org.id, "Closed", status="closed")
        cand = make_candidate(db_session, org.id, role.id)
        db_session.add(RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=closed.id, status="scored", overall_score=99.0))
        db_session.commit()
        assert client.get("/candidates/").json()[0]["best_match"] is None
