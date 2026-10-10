"""Pure rules: evidence verification, scoring math, redaction, suggestion labels, similarity."""

import pytest

from app.ai import embeddings
from app.models.rubric import RubricCriterion
from app.schemas.cards import InterviewFit, ResumeFit
from app.services import card_service, ranking_service


def _norm(text):
    return embeddings.normalize_ws(text)


class TestVerifiedScore:
    RESUME = _norm("Built a Rust compiler.\n  Led a team of   five engineers at Acme.")

    def test_real_quotes_kept_with_whitespace_and_case_normalisation(self):
        score, quotes = ranking_service.verified_score(
            4, ["built a rust compiler.", "Led a team of five engineers"], self.RESUME
        )
        assert score == 4 and len(quotes) == 2

    def test_hallucinated_quotes_are_dropped_and_unsupported_scores_capped(self):
        score, quotes = ranking_service.verified_score(5, ["Won a Turing award"], self.RESUME)
        assert (score, quotes) == (1, [])

    def test_low_scores_do_not_need_evidence(self):
        assert ranking_service.verified_score(0, [], self.RESUME) == (0, [])
        assert ranking_service.verified_score(1, [], self.RESUME) == (1, [])

    def test_partial_support_keeps_the_score(self):
        score, quotes = ranking_service.verified_score(3, ["Built a Rust compiler.", "made up"], self.RESUME)
        assert score == 3 and quotes == ["Built a Rust compiler."]

    @pytest.mark.parametrize("raw,expected", [(9, 5), (-3, 0)])
    def test_scores_are_clamped(self, raw, expected):
        assert ranking_service.verified_score(raw, ["Built a Rust compiler."], self.RESUME)[0] == expected

    def test_at_most_three_quotes(self):
        resume = _norm("a b c d")
        assert len(ranking_service.verified_score(3, ["a", "b", "c", "d"], resume)[1]) == 3


def _c(id_, weight, must=False):
    c = RubricCriterion(name=f"c{id_}", description="", weight=weight, must_have=must)
    c.id = id_
    return c


class TestOverall:
    def test_weighted_average_to_100(self):
        crit = [_c(1, 0.6), _c(2, 0.4)]
        overall, failed = ranking_service.compute_overall(
            [{"criterion_id": 1, "score": 5}, {"criterion_id": 2, "score": 0}], crit
        )
        assert overall == 60.0 and failed is False

    def test_weights_are_normalised(self):
        crit = [_c(1, 3), _c(2, 1)]  # 75% / 25%
        assert ranking_service.compute_overall(
            [{"criterion_id": 1, "score": 4}, {"criterion_id": 2, "score": 4}], crit
        )[0] == 80.0

    def test_missing_criterion_counts_as_zero(self):
        assert ranking_service.compute_overall([{"criterion_id": 1, "score": 5}], [_c(1, 0.5), _c(2, 0.5)])[0] == 50.0

    @pytest.mark.parametrize("score,failed", [(0, True), (1, True), (2, False), (5, False)])
    def test_must_have_fails_at_one_or_below(self, score, failed):
        crit = [_c(1, 0.5, must=True), _c(2, 0.5)]
        _, f = ranking_service.compute_overall(
            [{"criterion_id": 1, "score": score}, {"criterion_id": 2, "score": 5}], crit
        )
        assert f is failed

    def test_non_must_have_low_score_does_not_fail(self):
        crit = [_c(1, 0.5), _c(2, 0.5)]
        assert ranking_service.compute_overall([{"criterion_id": 1, "score": 0}, {"criterion_id": 2, "score": 5}], crit)[1] is False


class TestRedactionAndCanonicalText:
    BASICS = {"full_name": "Alice Smith", "email": "alice@example.com", "phone": "+1-555-0100"}
    EDU = [{"institution": "Massachusetts Institute of Technology"}]

    def test_identity_and_school_are_redacted_case_insensitively(self):
        text = "ALICE SMITH | alice@example.com | +1-555-0100\nBS at Massachusetts Institute of Technology\nBuilt Rust things"
        out = embeddings.redact_resume_text(text, self.BASICS, self.EDU)
        assert "alice" not in out.lower() and "massachusetts" not in out.lower() and "555" not in out
        assert "Built Rust things" in out and out.count("[REDACTED]") == 4

    def test_short_or_missing_values_are_ignored(self):
        assert embeddings.redact_resume_text("hello", {"full_name": "Al", "email": None}, None) == "hello"

    def test_canonical_text_excludes_identity_and_institutions(self):
        profile = {
            "basics": self.BASICS, "summary": "Backend engineer", "education": self.EDU,
            "experience": [{"designation": "Engineer", "company": "Acme", "description": "Built compilers", "technologies": ["Rust"]}],
            "projects": [{"name": "Lang", "description": "A language", "technologies": ["Rust"]}],
            "skills": {"programming_languages": ["Rust", "Go"], "frameworks": []},
            "metadata": {"total_experience_years": 6},
        }
        t = embeddings.resume_canonical_text(profile)
        assert "Backend engineer" in t and "Rust, Go" in t and "6 years" in t and "Built compilers" in t
        assert "Alice" not in t and "alice@" not in t and "Massachusetts" not in t


class TestSimilarity:
    def test_cosine(self):
        assert ranking_service.cosine([1, 0], [1, 0]) == pytest.approx(1)
        assert ranking_service.cosine([1, 0], [0, 1]) == pytest.approx(0)
        assert ranking_service.cosine([0, 0], [1, 1]) == 0.0


def _fit(score, must_failed=False):
    return ResumeFit(status="scored", overall_score=score, must_have_failed=must_failed)


def _iv(rec):
    return InterviewFit(count=1, technical_score=80, communication_score=80, confidence_score=80,
                        aggregate=80, latest_analysis_id=1, recommendation=rec)


class TestSuggestion:
    @pytest.mark.parametrize("score,label", [(95, "Strong yes"), (80, "Strong yes"), (79, "Yes"), (65, "Yes"),
                                             (64, "Lean no"), (45, "Lean no"), (44, "No"), (0, "No")])
    def test_resume_only_thresholds(self, score, label):
        s = card_service.suggest(_fit(score), None)
        assert (s.label, s.basis) == (label, "resume")

    @pytest.mark.parametrize("rec,label", [("Strong Hire", "Strong yes"), ("Hire", "Yes"), ("Lean No Hire", "Lean no"), ("No Hire", "No")])
    def test_interview_recommendation_wins_over_resume(self, rec, label):
        s = card_service.suggest(_fit(10), _iv(rec))
        assert (s.label, s.basis) == (label, "interview")

    def test_failed_must_have_caps_at_lean_no(self):
        assert card_service.suggest(_fit(95, must_failed=True), None).label == "Lean no"
        assert card_service.suggest(_fit(95, must_failed=True), _iv("Strong Hire")).label == "Lean no"
        assert card_service.suggest(_fit(95, must_failed=True), _iv("No Hire")).label == "No"  # never raised

    def test_high_severity_contradictions_lower_one_step_each(self):
        assert card_service.suggest(_fit(90), None, contradicted_high=1).label == "Yes"
        assert card_service.suggest(_fit(90), None, contradicted_high=9).label == "No"

    def test_no_data_means_no_label_and_always_the_caption(self):
        s = card_service.suggest(None, None)
        assert s.label is None and s.basis == "none"
        assert s.caption == "AI suggestion — final decision by your team"
        assert card_service.suggest(_fit(50), None).caption == s.caption
