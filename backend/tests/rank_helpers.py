"""Deterministic fakes for ranking tests: keyword embeddings + a rule-based scorer."""

import re
from contextlib import contextmanager
from unittest.mock import patch

from app.ai.schemas import CriterionScoreOut, RankOut
from app.models.resume_profile import ResumeProfile

KEYWORDS = ["rust", "python", "react", "sales"]


def fake_vec(text: str) -> list[float]:
    t = text.lower()
    return [t.count(k) + 0.01 for k in KEYWORDS]


def fake_embed(*, purpose, texts, org_id, job_id=None):
    return [fake_vec(t) for t in texts]


def fake_complete_json(**kw):
    """Scores 4 on every criterion if the resume mentions rust (quoting its first line), else 0.
    Always adds one fabricated quote so the verification step has something to drop."""
    assert kw["schema"] is RankOut
    user = kw["messages"][1]["content"]
    ids = [int(i) for i in re.findall(r"criterion_id=(\d+)", user)]
    resume = user.split("Resume:\n", 1)[1]
    has_rust = "rust" in resume.lower()
    first = resume.strip().split("\n")[0].strip()
    return RankOut(
        criteria=[
            CriterionScoreOut(
                criterion_id=i,
                score=4 if has_rust else 0,
                evidence=[first, "THIS QUOTE IS NOT IN THE RESUME"] if has_rust else [],
                reasoning="rule-based",
            )
            for i in ids
        ],
        explanation="Fits." if has_rust else "No overlap.",
    )


@contextmanager
def fake_ai():
    """Patch embeddings and the rank LLM call; yields the complete_json mock."""
    with patch("app.ai.embeddings.llm.embed", side_effect=fake_embed), patch(
        "app.services.ranking_service.llm.complete_json", side_effect=fake_complete_json
    ) as rank:
        yield rank


def make_profile(db, org_id, cand, raw_text, embed=True, **over):
    p = ResumeProfile(
        org_id=org_id,
        candidate_id=cand.id,
        basics=over.get("basics", {"full_name": cand.name, "email": cand.email, "phone": ""}),
        summary=raw_text.split("\n")[0],
        education=over.get("education", []),
        experience=[],
        projects=[],
        skills={},
        metadata_={"resume_pages": 1, "total_experience_years": 3},
        content_hash=over.get("content_hash", f"hash-{cand.id}"),
        raw_text=raw_text,
        embedding=fake_vec(raw_text) if embed else None,
    )
    db.add(p)
    db.commit()
    return p
