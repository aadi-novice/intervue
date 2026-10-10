"""Summary cards, compare matrix, interviewer scoping on rankings."""

import pytest

from app.models.analysis import Analysis
from app.models.interview import InterviewNote
from app.models.rubric import RoleMatch, RubricCriterion
from app.models.tenancy import AuditLog
from tests.factories import make_candidate, make_interview, make_role


@pytest.fixture()
def role(db_session, org):
    r = make_role(db_session, org.id, "Rust Engineer")
    db_session.add_all([
        RubricCriterion(org_id=org.id, role_id=r.id, name="Rust", description="", weight=0.6, must_have=True, position=0),
        RubricCriterion(org_id=org.id, role_id=r.id, name="Comms", description="", weight=0.4, must_have=False, position=1),
    ])
    db_session.commit()
    return r


def scored(db, org, role, cand, overall, scores=(4, 3), must_failed=False, evidence=("q1",)):
    crit = db.query(RubricCriterion).filter_by(role_id=role.id).order_by(RubricCriterion.position).all()
    m = RoleMatch(
        org_id=org.id, candidate_id=cand.id, role_id=role.id, status="scored", overall_score=overall,
        vector_similarity=0.5, must_have_failed=must_failed, explanation="because",
        rubric_scores=[{"criterion_id": c.id, "score": s, "evidence": list(evidence), "reasoning": "r"} for c, s in zip(crit, scores)],
    )
    db.add(m)
    db.commit()
    return m


def analysis(db, org, cand, iv, tech=80, comm=70, conf=60, rec="Hire", claims=None, created=None):
    a = Analysis(
        org_id=org.id, candidate_id=cand.id, interview_id=iv.id if iv else None, role_id=cand.role_id,
        summary="s", strengths=[], weaknesses=[], technical_score=tech, communication_score=comm,
        confidence_score=conf, hiring_recommendation=rec, resume_alignment=claims or [],
    )
    db.add(a)
    db.commit()
    return a


@pytest.fixture()
def cand(db_session, org, role):
    return make_candidate(db_session, org.id, role.id, "alice@example.com", name="Alice Doe")


class TestSummaryCard:
    def test_resume_only_card_has_per_criterion_bars_and_resume_basis(self, client, db_session, org, role, cand):
        scored(db_session, org, role, cand, 72.0, scores=(4, 3))
        card = client.get(f"/candidates/{cand.id}/summary-card").json()
        fit = card["resume_fit"]
        assert fit["overall_score"] == 72.0 and fit["explanation"] == "because"
        assert [(c["name"], c["score"], c["must_have"], c["evidence"]) for c in fit["criteria"]] == [
            ("Rust", 4, True, ["q1"]), ("Comms", 3, False, ["q1"])]
        assert card["interview"] is None
        assert card["suggestion"] == {"label": "Yes", "basis": "resume", "caption": "AI suggestion — final decision by your team"}
        assert card["claim_checks"] == {"verified": 0, "unclear": 0, "contradicted": 0, "flags": []}

    def test_unscored_candidate_has_no_label(self, client, cand):
        card = client.get(f"/candidates/{cand.id}/summary-card").json()
        assert card["resume_fit"] is None and card["suggestion"]["label"] is None and card["suggestion"]["basis"] == "none"

    def test_interview_scores_average_latest_analysis_per_interview(self, client, db_session, org, role, cand):
        iv1, iv2 = make_interview(db_session, org.id, cand, title="R1"), make_interview(db_session, org.id, cand, title="R2")
        analysis(db_session, org, cand, iv1, tech=40, comm=40, conf=40, rec="No Hire")  # superseded below
        analysis(db_session, org, cand, iv1, tech=80, comm=60, conf=70, rec="Hire")
        analysis(db_session, org, cand, iv2, tech=60, comm=80, conf=50, rec="Strong Hire")
        iv = client.get(f"/candidates/{cand.id}/summary-card").json()["interview"]
        assert iv["count"] == 2
        assert (iv["technical_score"], iv["communication_score"], iv["confidence_score"]) == (70, 70, 60)
        assert iv["aggregate"] == 67 and iv["recommendation"] == "Strong Hire"  # newest analysis' recommendation

    def test_interview_recommendation_drives_the_label(self, client, db_session, org, role, cand):
        scored(db_session, org, role, cand, 95.0)
        analysis(db_session, org, cand, make_interview(db_session, org.id, cand), rec="Lean No Hire")
        assert client.get(f"/candidates/{cand.id}/summary-card").json()["suggestion"] == {
            "label": "Lean no", "basis": "interview", "caption": "AI suggestion — final decision by your team"}

    def test_claim_checks_are_counted_and_contradictions_flagged_with_citations(self, client, db_session, org, role, cand):
        claims = [
            {"claim": "Rust expert", "verdict": "verified", "severity": "low", "segment_ids": [3]},
            {"claim": "Led 10 people", "verdict": "contradicted", "severity": "high", "segment_ids": [7]},
            {"claim": "Kubernetes", "verdict": "unclear", "severity": "high", "segment_ids": []},
            {"claim": "Python", "verdict": "unclear", "severity": "low", "segment_ids": []},
            {"claim": "legacy row without verdict", "result": "text", "severity": "low"},
        ]
        analysis(db_session, org, cand, make_interview(db_session, org.id, cand), claims=claims, rec="Strong Hire")
        scored(db_session, org, role, cand, 90.0)
        card = client.get(f"/candidates/{cand.id}/summary-card").json()
        assert (card["claim_checks"]["verified"], card["claim_checks"]["unclear"], card["claim_checks"]["contradicted"]) == (1, 3, 1)
        flags = {f["claim"]: f for f in card["claim_checks"]["flags"]}
        assert set(flags) == {"Led 10 people", "Kubernetes"} and flags["Led 10 people"]["segment_ids"] == [7]
        # one high-severity contradiction lowers 'Strong yes' by a step
        assert card["suggestion"]["label"] == "Yes"

    def test_notes_excerpt_is_truncated(self, client, db_session, org, role, cand):
        iv = make_interview(db_session, org.id, cand)
        db_session.add(InterviewNote(org_id=org.id, interview_id=iv.id, summary="x" * 400, key_points=[], topics=[], follow_ups=[]))
        db_session.commit()
        excerpt = client.get(f"/candidates/{cand.id}/summary-card").json()["notes_excerpt"]
        assert len(excerpt) == 301 and excerpt.endswith("…")

    def test_role_id_selects_the_role_and_validates_it(self, client, db_session, org, role, cand):
        other = make_role(db_session, org.id, "Other Role")
        db_session.add(RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=other.id, status="scored", overall_score=33.0, rubric_scores=[]))
        db_session.commit()
        assert client.get(f"/candidates/{cand.id}/summary-card?role_id={other.id}").json()["resume_fit"]["overall_score"] == 33.0
        assert client.get(f"/candidates/{cand.id}/summary-card?role_id=9999").status_code == 404

    def test_viewing_a_card_is_audited_and_org_scoped(self, client, other_client, db_session, org, cand):
        client.get(f"/candidates/{cand.id}/summary-card")
        assert db_session.query(AuditLog).filter_by(action="candidate.viewed", entity_id=str(cand.id)).count() == 1
        assert other_client.get(f"/candidates/{cand.id}/summary-card").status_code == 404

    def test_interviewer_only_gets_cards_for_their_candidates(self, role_client, db_session, org, cand):
        assert role_client("interviewer").get(f"/candidates/{cand.id}/summary-card").status_code == 404


class TestRankingsScoping:
    def test_interviewer_does_not_see_unassigned_candidates_in_rankings(self, role_client, db_session, org, role, cand):
        scored(db_session, org, role, cand, 80.0)
        assert role_client("interviewer").get(f"/roles/{role.id}/rankings").json()["total"] == 0
        assert role_client("hiring_manager").get(f"/roles/{role.id}/rankings").json()["total"] == 1

    def test_sort_puts_unscored_last_and_ties_by_similarity(self, client, db_session, org, role):
        a = make_candidate(db_session, org.id, role.id, "a@x.com", name="A")
        b = make_candidate(db_session, org.id, role.id, "b@x.com", name="B")
        c = make_candidate(db_session, org.id, role.id, "c@x.com", name="C")
        scored(db_session, org, role, a, 70.0).vector_similarity = 0.4
        scored(db_session, org, role, b, 70.0).vector_similarity = 0.9
        db_session.add(RoleMatch(org_id=org.id, candidate_id=c.id, role_id=role.id, status="shortlisted", vector_similarity=0.99))
        db_session.commit()
        names = [i["candidate"]["name"] for i in client.get(f"/roles/{role.id}/rankings").json()["items"]]
        assert names == ["B", "A", "C"]


class TestCompare:
    @pytest.fixture()
    def trio(self, db_session, org, role):
        out = []
        for name, overall, scores in (("A", 80.0, (5, 3)), ("B", 60.0, (3, 3)), ("C", 40.0, (1, 5))):
            c = make_candidate(db_session, org.id, role.id, f"{name.lower()}@x.com", name=name)
            scored(db_session, org, role, c, overall, scores=scores)
            out.append(c)
        return out

    def test_rows_cells_and_best_per_row(self, client, role, trio):
        ids = ",".join(str(c.id) for c in trio)
        m = client.get(f"/roles/{role.id}/compare?candidate_ids={ids}").json()
        rows = {r["key"]: r for r in m["rows"]}
        a, b, c = (t.id for t in trio)
        assert [x["name"] for x in m["candidates"]] == ["A", "B", "C"]
        assert rows["overall"]["best_candidate_ids"] == [a]
        rust = next(r for k, r in rows.items() if r["label"] == "Rust")
        comms = next(r for k, r in rows.items() if r["label"] == "Comms")
        assert [x["value"] for x in rust["cells"]] == [5, 3, 1] and rust["best_candidate_ids"] == [a]
        assert comms["best_candidate_ids"] == [c] and rust["cells"][0]["evidence"] == ["q1"]
        assert set(m["suggestions"]) == {str(a), str(b), str(c)}

    def test_lower_is_better_for_contradicted_claims_and_ties_have_no_winner(self, client, db_session, org, role, trio):
        a, b, c = trio
        analysis(db_session, org, a, make_interview(db_session, org.id, a),
                 claims=[{"claim": "x", "verdict": "contradicted", "severity": "low", "segment_ids": [1]}])
        analysis(db_session, org, b, make_interview(db_session, org.id, b), claims=[])
        m = client.get(f"/roles/{role.id}/compare?candidate_ids={a.id},{b.id}").json()
        row = next(r for r in m["rows"] if r["key"] == "contradicted")
        assert row["best_candidate_ids"] == [b.id]
        tech = next(r for r in m["rows"] if r["key"] == "technical")
        assert tech["best_candidate_ids"] == []  # equal values -> nobody highlighted

    @pytest.mark.parametrize("ids", ["1", "1,2,3,4,5", "a,b", ""])
    def test_selection_must_be_two_to_four_integers(self, client, role, ids):
        assert client.get(f"/roles/{role.id}/compare?candidate_ids={ids}").status_code == 422

    def test_duplicate_ids_collapse_and_unknown_candidates_404(self, client, role, trio):
        assert client.get(f"/roles/{role.id}/compare?candidate_ids={trio[0].id},{trio[0].id}").status_code == 422
        assert client.get(f"/roles/{role.id}/compare?candidate_ids={trio[0].id},9999").status_code == 404

    def test_cross_org(self, other_client, role, trio):
        ids = f"{trio[0].id},{trio[1].id}"
        assert other_client.get(f"/roles/{role.id}/compare?candidate_ids={ids}").status_code == 404

