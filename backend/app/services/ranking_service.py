"""
Resume indexing + two-stage ranking (M5.3-M5.5).

1. Shortlist: cosine similarity between the role embedding and every resume embedding in the org
   (pgvector on PostgreSQL, python fallback elsewhere) -> top K.
2. Score: per shortlisted candidate the LLM scores each rubric criterion 0-5 with verbatim resume
   quotes. Quotes are verified against the (redacted) resume text; unsupported scores are capped.
   overall = sum(weight * score / 5) * 100; must_have_failed if any must-have scores <= 1.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai import embeddings, llm
from app.ai.prompts import rank_v1
from app.ai.schemas import RankOut
from app.core.config import settings
from app.core.errors import Invalid, NotFound
from app.models.ai_run import AIRun
from app.models.job import Job
from app.models.resume_profile import ResumeProfile
from app.models.role import Role
from app.models.rubric import RoleMatch, RubricCriterion
from app.services import job_service, rubric_service

log = logging.getLogger(__name__)

RANK_KIND = "rank"
MUST_HAVE_FAIL_AT = 1  # a must-have scoring <= 1 fails the role


# ── vectors ───────────────────────────────────────────────────────────────────
def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def similar_resumes(db: Session, org_id: int, vec: list[float], k: int) -> list[tuple[int, float]]:
    """Top-k (candidate_id, cosine similarity) among the org's embedded resumes."""
    if db.bind.dialect.name == "postgresql":
        rows = db.execute(
            text(
                "SELECT candidate_id, 1 - (embedding <=> CAST(:v AS vector)) AS sim "
                "FROM resume_profiles WHERE org_id = :org AND embedding IS NOT NULL "
                "ORDER BY embedding <=> CAST(:v AS vector) LIMIT :k"
            ),
            {"v": _vec_literal(vec), "org": org_id, "k": k},
        ).all()
        return [(r[0], float(r[1])) for r in rows]
    profiles = (
        db.query(ResumeProfile)
        .filter(ResumeProfile.org_id == org_id, ResumeProfile.embedding.isnot(None))
        .all()
    )
    scored = [(p.candidate_id, cosine(vec, p.embedding)) for p in profiles]
    return sorted(scored, key=lambda t: -t[1])[:k]


def similar_roles(db: Session, org_id: int, vec: list[float], k: int) -> list[tuple[int, float]]:
    """Open roles most similar to a resume embedding."""
    if db.bind.dialect.name == "postgresql":
        rows = db.execute(
            text(
                "SELECT id, 1 - (jd_embedding <=> CAST(:v AS vector)) AS sim FROM roles "
                "WHERE org_id = :org AND status = 'open' AND jd_embedding IS NOT NULL "
                "ORDER BY jd_embedding <=> CAST(:v AS vector) LIMIT :k"
            ),
            {"v": _vec_literal(vec), "org": org_id, "k": k},
        ).all()
        return [(r[0], float(r[1])) for r in rows]
    roles = (
        db.query(Role)
        .filter(Role.org_id == org_id, Role.status == "open", Role.jd_embedding.isnot(None))
        .all()
    )
    return sorted(((r.id, cosine(vec, r.jd_embedding)) for r in roles), key=lambda t: -t[1])[:k]


# ── indexing ──────────────────────────────────────────────────────────────────
def profile_dict(p: ResumeProfile) -> dict:
    return {
        "basics": p.basics, "summary": p.summary, "education": p.education,
        "experience": p.experience, "projects": p.projects, "skills": p.skills,
        "metadata": p.metadata_,
    }


def embed_role(db: Session, org_id: int, role_id: int, job_id: int | None = None) -> Role:
    role = db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first()
    if role is None:
        raise NotFound("Role not found")
    rubric = rubric_service.list_criteria(db, org_id, role_id)
    text_ = embeddings.role_canonical_text(
        role.name, role.experience_level, role.experience_required_years, role.description, rubric
    )
    role.jd_embedding = embeddings.embed_texts([text_], org_id, "embedding", job_id)[0]
    db.commit()
    return role


def embed_profile(db: Session, org_id: int, profile: ResumeProfile, job_id: int | None = None) -> None:
    text_ = embeddings.resume_canonical_text(profile_dict(profile))
    profile.embedding = embeddings.embed_texts([text_], org_id, "embedding", job_id)[0]
    db.commit()


def cross_role_matches(db: Session, org_id: int, candidate_id: int, vec: list[float]) -> int:
    """Record similarity against every open role so 'also a strong fit for...' can be shown."""
    n = 0
    for role_id, sim in similar_roles(db, org_id, vec, settings.cross_role_max_matches):
        if sim < settings.cross_role_min_similarity:
            continue
        m = (
            db.query(RoleMatch)
            .filter(RoleMatch.candidate_id == candidate_id, RoleMatch.role_id == role_id)
            .first()
        )
        if m is None:
            m = RoleMatch(org_id=org_id, candidate_id=candidate_id, role_id=role_id, status="shortlisted")
            db.add(m)
        m.vector_similarity = sim
        n += 1
    db.commit()
    return n


def index_candidate(db: Session, org_id: int, candidate_id: int) -> None:
    """Embed the resume and refresh cross-role similarity. Failures never block ingestion."""
    prof = db.query(ResumeProfile).filter(
        ResumeProfile.candidate_id == candidate_id, ResumeProfile.org_id == org_id
    ).first()
    if prof is None:
        return
    try:
        if prof.embedding is None:
            embed_profile(db, org_id, prof)
        cross_role_matches(db, org_id, candidate_id, prof.embedding)
    except Exception:
        db.rollback()
        log.exception("indexing failed for candidate %s", candidate_id)


def schedule_rank(org_id: int, role_id: int) -> None:
    """Debounced auto re-rank: a queued/running job absorbs further triggers."""
    from app.db import session as db_session
    from app.worker.tasks.ranking import rank_role_task

    db = db_session.SessionLocal()
    try:
        role = db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first()
        if role is None or not rubric_service.list_criteria(db, org_id, role_id):
            return  # nothing to rank against yet
        try:
            job = job_service.create(db, org_id, RANK_KIND, "role", role_id)
        except Exception:
            return  # already queued or running
        rank_role_task.apply_async(
            args=(org_id, role_id, job.id), countdown=settings.rank_debounce_seconds
        )
    finally:
        db.close()


# ── scoring ───────────────────────────────────────────────────────────────────
@dataclass
class _Scored:
    match_id: int
    out: RankOut | None
    error: str | None


def verified_score(score: int, evidence: list[str], resume_norm: str) -> tuple[int, list[str]]:
    """Keep only quotes that really appear in the resume; cap unsupported scores at 1."""
    quotes = [q.strip() for q in evidence if q and embeddings.normalize_ws(q) in resume_norm]
    score = max(0, min(5, int(score)))
    if score >= 2 and not quotes:
        score = 1
    return score, quotes[:3]


def compute_overall(scores: list[dict], criteria: list[RubricCriterion]) -> tuple[float, bool]:
    by_id = {s["criterion_id"]: s["score"] for s in scores}
    total_w = sum(c.weight for c in criteria) or 1.0
    overall = sum((c.weight / total_w) * (by_id.get(c.id, 0) / 5) for c in criteria) * 100
    failed = any(c.must_have and by_id.get(c.id, 0) <= MUST_HAVE_FAIL_AT for c in criteria)
    return round(overall, 1), failed


def _llm_score(org_id, job_id, role_summary, crit_payload, text_, candidate_id=None) -> RankOut:
    return llm.complete_json(
        purpose="rank",
        prompt_version=rank_v1.VERSION,
        messages=rank_v1.build_messages(role_summary, crit_payload, text_),
        schema=RankOut,
        org_id=org_id,
        temperature=0.0,
        job_id=job_id,
        candidate_id=candidate_id,
    )


def rank_role(db: Session, org_id: int, role_id: int, job_id: int) -> dict:
    role = db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first()
    if role is None:
        raise NotFound("Role not found")
    criteria = rubric_service.list_criteria(db, org_id, role_id)
    if not criteria:
        raise Invalid("Define a rubric before ranking", "no_rubric")
    rhash = rubric_service.rubric_hash(criteria)

    # embeddings for the role and any resume that has none yet
    embed_role(db, org_id, role_id, job_id)
    pending = (
        db.query(ResumeProfile)
        .filter(ResumeProfile.org_id == org_id, ResumeProfile.embedding.is_(None))
        .all()
    )
    for p in pending:
        embed_profile(db, org_id, p, job_id)

    # stage 1: shortlist
    role = db.get(Role, role_id)
    short = similar_resumes(db, org_id, role.jd_embedding, settings.rank_shortlist_k)
    matches: dict[int, RoleMatch] = {}
    for cid, sim in short:
        m = (
            db.query(RoleMatch)
            .filter(RoleMatch.candidate_id == cid, RoleMatch.role_id == role_id)
            .first()
        )
        if m is None:
            m = RoleMatch(org_id=org_id, candidate_id=cid, role_id=role_id, status="shortlisted")
            db.add(m)
        m.vector_similarity = sim
        if m.status in ("pending", "failed"):
            m.status = "shortlisted"
        matches[cid] = m
    db.commit()

    # stage 2: score (skip matches already scored against this exact rubric)
    todo = [m for m in matches.values() if not (m.status == "scored" and m.rubric_hash == rhash)]
    crit_payload = [
        {"id": c.id, "name": c.name, "description": c.description, "must_have": c.must_have}
        for c in criteria
    ]
    role_summary = embeddings.role_canonical_text(
        role.name, role.experience_level, role.experience_required_years, role.description, criteria
    )
    jobs: dict = {}
    profiles = {
        p.candidate_id: p
        for p in db.query(ResumeProfile).filter(
            ResumeProfile.org_id == org_id, ResumeProfile.candidate_id.in_(list(matches))
        )
    }
    texts: dict[int, str] = {}
    for m in todo:
        p = profiles.get(m.candidate_id)
        raw = (p.raw_text if p else None) or ""
        if not raw:
            m.status, m.explanation = "failed", "No resume text available"
            continue
        texts[m.candidate_id] = embeddings.redact_resume_text(raw, p.basics, p.education)
    db.commit()

    scored = failed = 0
    runnable = [m for m in todo if m.candidate_id in texts]
    job_service.set_status(db, job_id, "running", result={"total": len(runnable), "scored": 0, "failed": failed})
    with ThreadPoolExecutor(max_workers=max(1, settings.rank_concurrency)) as pool:
        for m in runnable:
            jobs[
                pool.submit(
                    _llm_score, org_id, job_id, role_summary, crit_payload, texts[m.candidate_id],
                    m.candidate_id,
                )
            ] = m
        for fut in as_completed(jobs):
            m = jobs[fut]
            try:
                out = fut.result()
            except Exception as e:  # one bad candidate must not sink the run
                log.exception("rank failed for candidate %s", m.candidate_id)
                m.status, m.explanation = "failed", f"Scoring failed: {str(e)[:200]}"
                failed += 1
            else:
                _apply(m, out, criteria, texts[m.candidate_id], rhash)
                scored += 1
            db.commit()
            job_service.set_status(
                db, job_id, "running", result={"total": len(runnable), "scored": scored, "failed": failed}
            )
    cost = (
        db.query(AIRun)
        .filter(AIRun.org_id == org_id, AIRun.job_id == job_id)
        .with_entities(AIRun.cost_usd)
        .all()
    )
    result = {
        "total": len(runnable),
        "scored": scored,
        "failed": failed,
        "shortlisted": len(matches),
        "cost_usd": float(sum(c[0] or 0 for c in cost)),
    }
    return result


def _apply(m: RoleMatch, out: RankOut, criteria, resume_text: str, rhash: str) -> None:
    norm = embeddings.normalize_ws(resume_text)
    given = {c.criterion_id: c for c in out.criteria}
    rows = []
    for c in criteria:
        g = given.get(c.id)
        score, quotes = (
            verified_score(g.score, g.evidence, norm) if g else (0, [])
        )
        rows.append(
            {
                "criterion_id": c.id,
                "score": score,
                "evidence": quotes,
                "reasoning": g.reasoning if g else "Not assessed",
            }
        )
    m.rubric_scores = rows
    m.overall_score, m.must_have_failed = compute_overall(rows, criteria)
    m.explanation = out.explanation
    m.status = "scored"
    m.rubric_hash = rhash
    m.prompt_version = rank_v1.VERSION
    m.model = settings.model_rank


def unscored_count(db: Session, org_id: int, role_id: int) -> int:
    return (
        db.query(RoleMatch)
        .filter(
            RoleMatch.org_id == org_id,
            RoleMatch.role_id == role_id,
            RoleMatch.status.in_(("shortlisted", "pending")),
        )
        .count()
    )


def request_rank(db: Session, org_id: int, role_id: int, user_id: int | None = None) -> Job:
    criteria = rubric_service.list_criteria(db, org_id, role_id)
    if not criteria:
        raise Invalid("Define a rubric before ranking", "no_rubric")
    job = job_service.create(db, org_id, RANK_KIND, "role", role_id, requested_by=user_id)
    from app.worker.tasks.ranking import rank_role_task

    rank_role_task.delay(org_id, role_id, job.id)
    return job
