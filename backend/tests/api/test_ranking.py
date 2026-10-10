"""Rubrics, ranking pipeline, rankings listing, blind review."""

from unittest.mock import patch

import pytest

from app.ai.schemas import RubricSuggestOut, SuggestedCriterion
from app.core.config import settings
from app.models.analysis import Analysis
from app.models.job import Job
from app.models.rubric import RoleMatch
from app.models.tenancy import AuditLog
from tests.factories import make_candidate, make_role
from tests.rank_helpers import fake_ai, make_profile

STRONG = "Built a production Rust compiler. rust rust rust systems work."
MEDIUM = "Wrote some Rust tooling and mostly python scripts."
WEAK = "Enterprise sales manager. sales sales quota."

RUBRIC = {
    "criteria": [
        {"name": "Systems programming", "description": "Rust or C++", "weight": 3, "must_have": True},
        {"name": "Delivery", "description": "Ships work", "weight": 1, "must_have": False},
    ]
}


@pytest.fixture(autouse=True)
def _ai():
    with fake_ai() as rank:
        yield rank


@pytest.fixture()
def manual_rank():
    """Disable the debounced auto re-rank so tests control exactly when ranking runs."""
    with patch("app.services.ranking_service.schedule_rank"):
        yield


@pytest.fixture()
def role(db_session, org):
    return make_role(db_session, org.id, "Rust Engineer", description="We need a Rust systems engineer")


@pytest.fixture()
def cands(db_session, org, role):
    out = {}
    for key, name, text in (("strong", "Alice Strong", STRONG), ("medium", "Bob Medium", MEDIUM), ("weak", "Cara Weak", WEAK)):
        c = make_candidate(db_session, org.id, role.id, f"{key}@example.com", name=name)
        make_profile(db_session, org.id, c, f"{text}\nContact {name} at {key}@example.com", content_hash=key)
        out[key] = c
    return out


@pytest.fixture()
def ranked(client, role, cands):
    assert client.put(f"/roles/{role.id}/rubric", json=RUBRIC).status_code == 200
    r = client.post(f"/roles/{role.id}/rank")
    assert r.status_code == 202
    return role


class TestRubric:
    def test_put_normalises_weights_and_orders(self, client, role):
        r = client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        assert r.status_code == 200
        crit = r.json()["criteria"]
        assert [c["name"] for c in crit] == ["Systems programming", "Delivery"]
        assert [c["weight"] for c in crit] == pytest.approx([0.75, 0.25])
        assert crit[0]["must_have"] is True and r.json()["rubric_hash"]

    def test_edit_by_id_keeps_ids_and_deletes_omitted(self, client, role):
        first = client.put(f"/roles/{role.id}/rubric", json=RUBRIC).json()["criteria"]
        edited = {"criteria": [{**first[1], "name": "Delivery speed"}, {"name": "New one", "weight": 1}]}
        second = client.put(f"/roles/{role.id}/rubric", json=edited).json()
        assert second["criteria"][0]["id"] == first[1]["id"] and second["criteria"][0]["name"] == "Delivery speed"
        assert first[0]["id"] not in {c["id"] for c in second["criteria"]}
        assert [c["name"] for c in client.get(f"/roles/{role.id}/rubric").json()["criteria"]] == ["Delivery speed", "New one"]

    @pytest.mark.parametrize("body,code", [
        ({"criteria": []}, "rubric_empty"),
        ({"criteria": [{"name": "a", "weight": 0.5}, {"name": "A", "weight": 0.5}]}, "rubric_names"),
        ({"criteria": [{"name": "a", "weight": 0}]}, "rubric_weights"),
        ({"criteria": [{"name": f"c{i}", "weight": 0.1} for i in range(13)]}, "rubric_too_large"),
        ({"criteria": [{"id": 999, "name": "ghost", "weight": 1}]}, "rubric_unknown_id"),
    ])
    def test_validation(self, client, role, body, code):
        r = client.put(f"/roles/{role.id}/rubric", json=body)
        assert r.status_code == 422 and r.json()["code"] == code

    @pytest.mark.parametrize("w", [-1, 101])
    def test_weight_range_enforced_by_schema(self, client, role, w):
        assert client.put(f"/roles/{role.id}/rubric", json={"criteria": [{"name": "a", "weight": w}]}).status_code == 422

    def test_rubric_hash_changes_when_content_changes(self, client, role):
        h1 = client.put(f"/roles/{role.id}/rubric", json=RUBRIC).json()["rubric_hash"]
        crit = client.get(f"/roles/{role.id}/rubric").json()["criteria"]
        body = {"criteria": [{**crit[0], "description": "Rust, C++ or Zig"}, crit[1]]}
        assert client.put(f"/roles/{role.id}/rubric", json=body).json()["rubric_hash"] != h1

    def test_only_recruiters_write_and_orgs_are_isolated(self, role_client, other_client, client, role):
        assert role_client("interviewer").put(f"/roles/{role.id}/rubric", json=RUBRIC).status_code == 403
        assert role_client("hiring_manager").get(f"/roles/{role.id}/rubric").status_code == 200
        assert other_client.get(f"/roles/{role.id}/rubric").status_code == 404
        assert other_client.put(f"/roles/{role.id}/rubric", json=RUBRIC).status_code == 404

    def test_suggest_needs_a_jd_then_runs_as_a_job(self, client, db_session, org, role):
        bare = make_role(db_session, org.id, "No JD")
        assert client.post(f"/roles/{bare.id}/rubric/suggest").json()["code"] == "no_description"
        out = RubricSuggestOut(criteria=[
            SuggestedCriterion(name="Rust", description="d", weight=2, must_have=True),
            SuggestedCriterion(name="Comms", description="d", weight=2, must_have=False),
            SuggestedCriterion(name=" ", description="blank dropped", weight=1, must_have=False),
        ])
        with patch("app.services.rubric_service.llm.complete_json", return_value=out) as llm_call:
            r = client.post(f"/roles/{role.id}/rubric/suggest")
        assert r.status_code == 202 and r.json()["status"] == "queued"
        assert llm_call.call_args.kwargs["purpose"] == "rubric_suggest"
        st = client.get(f"/roles/{role.id}/rubric/suggest/status").json()
        assert st["status"] == "completed"
        assert [(c["name"], c["weight"]) for c in st["criteria"]] == [("Rust", 0.5), ("Comms", 0.5)]
        # suggestions are NOT saved until the user edits and PUTs them
        assert client.get(f"/roles/{role.id}/rubric").json()["criteria"] == []


@pytest.mark.usefixtures("manual_rank")
class TestRankPipeline:
    def test_rank_requires_a_rubric(self, client, role):
        r = client.post(f"/roles/{role.id}/rank")
        assert r.status_code == 422 and r.json()["code"] == "no_rubric"

    def test_shortlist_scores_and_orders_by_overall(self, ranked, client, cands, _ai):
        st = client.get(f"/roles/{ranked.id}/rank/status").json()
        assert st["status"] == "completed" and st["progress"]["scored"] == 3  # weak scores 0 but is scored
        page = client.get(f"/roles/{ranked.id}/rankings").json()
        names = [i["candidate"]["name"] for i in page["items"]]
        assert names[0] == "Alice Strong" and page["total"] == 3
        top = page["items"][0]["resume_fit"]
        assert top["overall_score"] == 80.0 and top["must_have_failed"] is False
        assert [c["name"] for c in top["criteria"]] == ["Systems programming", "Delivery"]

    def test_fabricated_quotes_never_reach_the_card(self, ranked, client):
        top = client.get(f"/roles/{ranked.id}/rankings").json()["items"][0]["resume_fit"]
        for c in top["criteria"]:
            assert c["evidence"] and all("NOT IN THE RESUME" not in q for q in c["evidence"])

    def test_resume_text_sent_to_the_llm_is_redacted(self, ranked, client, cands, _ai):
        sent = " ".join(call.kwargs["messages"][1]["content"] for call in _ai.call_args_list)
        assert "Alice Strong" not in sent and "strong@example.com" not in sent
        assert "[REDACTED]" in sent

    def test_failed_must_have_flag_and_filter(self, ranked, client):
        weak = [i for i in client.get(f"/roles/{ranked.id}/rankings").json()["items"] if i["candidate"]["name"] == "Cara Weak"][0]
        assert weak["resume_fit"]["must_have_failed"] is True and weak["suggestion"]["label"] == "No"
        met = client.get(f"/roles/{ranked.id}/rankings?must_haves_met=true").json()
        assert {i["candidate"]["name"] for i in met["items"]} == {"Alice Strong", "Bob Medium"}
        failed = client.get(f"/roles/{ranked.id}/rankings?must_haves_met=false").json()
        assert [i["candidate"]["name"] for i in failed["items"]] == ["Cara Weak"]

    def test_score_and_stage_filters_and_pagination(self, ranked, client, cands, db_session):
        assert client.get(f"/roles/{ranked.id}/rankings?min_score=79").json()["total"] == 2
        assert client.get(f"/roles/{ranked.id}/rankings?max_score=10").json()["total"] == 1
        cands["strong"].status = "offer"
        db_session.commit()
        assert [i["candidate"]["name"] for i in client.get(f"/roles/{ranked.id}/rankings?stage=offer").json()["items"]] == ["Alice Strong"]
        page = client.get(f"/roles/{ranked.id}/rankings?limit=1&offset=1").json()
        assert len(page["items"]) == 1 and page["total"] == 3
        assert client.get(f"/roles/{ranked.id}/rankings?limit=0").status_code == 422

    def test_interviewed_filter(self, ranked, client, cands, db_session, org):
        db_session.add(Analysis(org_id=org.id, candidate_id=cands["strong"].id, role_id=ranked.id, summary="s",
                                strengths=[], weaknesses=[], technical_score=80, communication_score=80, confidence_score=80))
        db_session.commit()
        yes = client.get(f"/roles/{ranked.id}/rankings?interviewed=true").json()["items"]
        assert [i["candidate"]["name"] for i in yes] == ["Alice Strong"] and yes[0]["interview"]["aggregate"] == 80
        assert client.get(f"/roles/{ranked.id}/rankings?interviewed=false").json()["total"] == 2

    def test_unchanged_matches_are_not_rescored_but_rubric_edits_are(self, ranked, client, _ai):
        calls = _ai.call_count
        client.post(f"/roles/{ranked.id}/rank")
        assert _ai.call_count == calls  # same rubric hash -> cached scores reused
        crit = client.get(f"/roles/{ranked.id}/rubric").json()["criteria"]
        client.put(f"/roles/{ranked.id}/rubric", json={"criteria": [{**crit[0], "description": "changed"}, crit[1]]})
        client.post(f"/roles/{ranked.id}/rank")
        assert _ai.call_count > calls

    def test_shortlist_is_limited_to_top_k_by_similarity(self, client, role, cands):
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        with patch.object(settings, "rank_shortlist_k", 1):
            client.post(f"/roles/{role.id}/rank")
        page = client.get(f"/roles/{role.id}/rankings").json()
        scored = [i["candidate"]["name"] for i in page["items"] if i["resume_fit"]["status"] == "scored"]
        assert scored == ["Alice Strong"]

    def test_one_failing_candidate_does_not_sink_the_run(self, client, role, cands, _ai):
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        original = _ai.side_effect

        def flaky(**kw):
            if "Bob" in kw["messages"][1]["content"] or "mostly python" in kw["messages"][1]["content"]:
                raise RuntimeError("model hiccup")
            return original(**kw)

        _ai.side_effect = flaky
        client.post(f"/roles/{role.id}/rank")
        st = client.get(f"/roles/{role.id}/rank/status").json()
        assert st["status"] == "completed" and st["progress"]["failed"] == 1
        items = {i["candidate"]["name"]: i for i in client.get(f"/roles/{role.id}/rankings").json()["items"]}
        assert items["Bob Medium"]["resume_fit"]["status"] == "failed"
        assert items["Alice Strong"]["resume_fit"]["status"] == "scored"

    def test_job_id_is_passed_so_cost_can_be_attributed(self, ranked, _ai):
        assert _ai.call_count >= 2
        assert all(call.kwargs["job_id"] for call in _ai.call_args_list)
        assert all(call.kwargs["purpose"] == "rank" and call.kwargs["temperature"] == 0 for call in _ai.call_args_list)

    def test_duplicate_rank_while_running_conflicts_and_rate_limit(self, client, role, cands, db_session, org):
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        db_session.add(Job(org_id=org.id, kind="rank", entity_type="role", entity_id=role.id, status="running"))
        db_session.commit()
        r = client.post(f"/roles/{role.id}/rank")
        assert r.status_code == 409 and r.json()["code"] == "job_in_progress"

    def test_rate_limited_per_org(self, client, role, cands):
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        with patch.object(settings, "limit_rank_per_hour", 1):
            assert client.post(f"/roles/{role.id}/rank").status_code == 202
            assert client.post(f"/roles/{role.id}/rank").status_code == 429

    def test_other_orgs_resumes_are_never_shortlisted(self, client, other_client, db_session, other_org, role):
        r2 = make_role(db_session, other_org.id, "Rust Engineer", description="x")
        stranger = make_candidate(db_session, other_org.id, r2.id, "stranger@example.com", name="Stranger Danger")
        make_profile(db_session, other_org.id, stranger, STRONG, content_hash="s")
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        client.post(f"/roles/{role.id}/rank")
        assert db_session.query(RoleMatch).filter_by(candidate_id=stranger.id).count() == 0
        assert client.get(f"/roles/{role.id}/rankings").json()["total"] == 0

    def test_rankings_of_other_orgs_role_404(self, other_client, role):
        assert other_client.get(f"/roles/{role.id}/rankings").status_code == 404
        assert other_client.post(f"/roles/{role.id}/rank").status_code == 404

    def test_missing_resume_text_marks_match_failed(self, client, db_session, org, role):
        c = make_candidate(db_session, org.id, role.id, "blank@example.com", name="Blank")
        make_profile(db_session, org.id, c, "", embed=False, content_hash="b")
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        # embedding of "" still works in the fake; the match must fail on missing text
        client.post(f"/roles/{role.id}/rank")
        m = db_session.query(RoleMatch).filter_by(candidate_id=c.id).one()
        assert m.status == "failed" and "No resume text" in m.explanation


@pytest.mark.usefixtures("manual_rank")
class TestBlindReview:
    @pytest.fixture()
    def blind(self, ranked, client, org):
        assert client.patch(f"/orgs/{org.id}/settings", json={"blind_review": True}).status_code == 200
        return ranked

    def test_identity_is_hidden_in_rankings_and_cards(self, blind, client, cands):
        items = client.get(f"/roles/{blind.id}/rankings").json()["items"]
        for i in items:
            c = i["candidate"]
            assert c["blind"] is True and c["name"].startswith("Candidate #")
            assert c["email"] is None and c["avatar_url"] is None
        card = client.get(f"/candidates/{cands['strong'].id}/summary-card").json()
        assert card["candidate"]["blind"] is True and "Alice" not in str(card)

    def test_reveal_is_per_user_per_candidate_and_audited(self, blind, client, cands, db_session, role_client, org):
        cid = cands["strong"].id
        assert client.post(f"/candidates/{cid}/reveal").status_code == 204
        items = {i["candidate"]["id"]: i["candidate"] for i in client.get(f"/roles/{blind.id}/rankings").json()["items"]}
        assert items[cid]["blind"] is False and items[cid]["name"] == "Alice Strong"
        assert items[cands["medium"].id]["blind"] is True
        assert db_session.query(AuditLog).filter_by(action="candidate.revealed", entity_id=str(cid)).count() == 1
        # another user still sees it masked
        other = role_client("recruiter")
        masked = {i["candidate"]["id"]: i["candidate"] for i in other.get(f"/roles/{blind.id}/rankings").json()["items"]}
        assert masked[cid]["blind"] is True

    def test_interviewers_cannot_reveal(self, blind, role_client, cands):
        assert role_client("interviewer").post(f"/candidates/{cands['strong'].id}/reveal").status_code == 403

    def test_blind_off_shows_names(self, ranked, client):
        assert client.get(f"/roles/{ranked.id}/rankings").json()["items"][0]["candidate"]["blind"] is False

    def test_compare_is_blind_too(self, blind, client, cands):
        ids = f"{cands['strong'].id},{cands['medium'].id}"
        m = client.get(f"/roles/{blind.id}/compare?candidate_ids={ids}").json()
        assert all(c["blind"] for c in m["candidates"]) and "Alice" not in str(m)


class TestAutoRank:
    def test_saving_a_rubric_embeds_the_role_and_ranks_without_an_explicit_request(
        self, client, role, cands, db_session
    ):
        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        db_session.expire_all()
        assert db_session.get(type(role), role.id).jd_embedding is not None
        st = client.get(f"/roles/{role.id}/rank/status").json()
        assert st["status"] == "completed" and st["progress"]["scored"] == 3
        assert client.get(f"/roles/{role.id}/rankings").json()["items"][0]["candidate"]["name"] == "Alice Strong"

    def test_no_auto_rank_without_a_rubric(self, client, role, cands):
        client.patch(f"/roles/{role.id}", json={"description": "Updated JD"})
        assert client.get(f"/roles/{role.id}/rank/status").json()["status"] == "none"

    def test_a_queued_job_absorbs_further_triggers(self, client, role, cands, db_session, org):
        from app.services import ranking_service

        client.put(f"/roles/{role.id}/rubric", json=RUBRIC)
        db_session.add(Job(org_id=org.id, kind="rank", entity_type="role", entity_id=role.id, status="queued"))
        db_session.commit()
        before = db_session.query(Job).filter_by(kind="rank").count()
        ranking_service.schedule_rank(org.id, role.id)
        assert db_session.query(Job).filter_by(kind="rank").count() == before
