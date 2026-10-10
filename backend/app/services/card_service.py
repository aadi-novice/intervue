"""Summary cards, role rankings, compare matrix and blind-review masking (M5.6-M5.8)."""

from collections import defaultdict

from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import storage
from app.core.config import settings
from app.core.errors import Invalid
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.interview import Interview, InterviewNote
from app.models.rubric import CandidateReveal, RoleMatch, RubricCriterion
from app.schemas.cards import (
    CandidateMini,
    ClaimChecks,
    ClaimFlag,
    CompareMatrix,
    CompareRow,
    CompareRowCell,
    CriterionResult,
    InterviewFit,
    MatchOut,
    RankingPage,
    ResumeFit,
    Suggestion,
    SummaryCard,
)
from app.services import audit_service, candidate_service, job_service, role_service, rubric_service

CAPTION = "AI suggestion — final decision by your team"
REC_LABEL = {"Strong Hire": "Strong yes", "Hire": "Yes", "Lean No Hire": "Lean no", "No Hire": "No"}
LADDER = ["No", "Lean no", "Yes", "Strong yes"]
ANON_NAME = "Candidate #{id}"


# ── suggestion (deterministic, documented) ────────────────────────────────────
def suggest(resume: ResumeFit | None, interview: InterviewFit | None, contradicted_high: int = 0) -> Suggestion:
    """Interview recommendation wins when there is one; otherwise the resume score decides.

    Caps: a failed must-have caps the label at 'Lean no'; each high-severity contradicted claim
    lowers it one step. It is always a suggestion for humans.
    """
    if interview and interview.recommendation in REC_LABEL:
        label, basis = REC_LABEL[interview.recommendation], "interview"
    elif resume and resume.overall_score is not None:
        s = resume.overall_score
        label = "Strong yes" if s >= 80 else "Yes" if s >= 65 else "Lean no" if s >= 45 else "No"
        basis = "resume"
    else:
        return Suggestion(label=None, basis="none", caption=CAPTION)
    idx = LADDER.index(label)
    if resume and resume.must_have_failed:
        idx = min(idx, LADDER.index("Lean no"))
    idx = max(0, idx - contradicted_high)
    return Suggestion(label=LADDER[idx], basis=basis, caption=CAPTION)


# ── blind review ──────────────────────────────────────────────────────────────
def blind_enabled(ctx: OrgContext) -> bool:
    return bool((ctx.org.settings or {}).get("blind_review"))


def revealed_ids(db: Session, ctx: OrgContext) -> set[int]:
    return {
        r[0]
        for r in db.query(CandidateReveal.candidate_id).filter(
            CandidateReveal.org_id == ctx.org_id, CandidateReveal.user_id == ctx.user.id
        )
    }


def reveal(db: Session, ctx: OrgContext, candidate_id: int) -> None:
    candidate_service.get_candidate(db, ctx, candidate_id)
    if not blind_enabled(ctx):
        return
    if candidate_id not in revealed_ids(db, ctx):
        db.add(CandidateReveal(org_id=ctx.org_id, user_id=ctx.user.id, candidate_id=candidate_id))
    audit_service.record(db, ctx, "candidate.revealed", "candidate", candidate_id)
    db.commit()


def mini(c: Candidate, blind: bool) -> CandidateMini:
    if blind:
        return CandidateMini(
            id=c.id, name=ANON_NAME.format(id=c.id), email=None, avatar_url=None,
            avatar="?", stage=c.status, blind=True, role_id=c.role_id,
        )
    return CandidateMini(
        id=c.id, name=c.name, email=c.email,
        avatar_url=storage.presigned_get(c.avatar_path) if c.avatar_path else None,
        avatar="".join(p[0].upper() for p in c.name.split()[:2]),
        stage=c.status, blind=False, role_id=c.role_id,
    )


# ── building cards ────────────────────────────────────────────────────────────
def _fit(m: RoleMatch | None, criteria: list[RubricCriterion]) -> ResumeFit | None:
    if m is None:
        return None
    by_id = {s["criterion_id"]: s for s in (m.rubric_scores or [])}
    results = []
    for c in criteria:
        s = by_id.get(c.id)
        if s is None and m.status != "scored":
            continue
        results.append(
            CriterionResult(
                criterion_id=c.id, name=c.name, weight=round(c.weight, 4), must_have=c.must_have,
                score=(s or {}).get("score", 0), evidence=(s or {}).get("evidence", []),
                reasoning=(s or {}).get("reasoning", ""),
            )
        )
    return ResumeFit(
        status=m.status, overall_score=m.overall_score, vector_similarity=m.vector_similarity,
        must_have_failed=bool(m.must_have_failed), explanation=m.explanation,
        criteria=results, stale=False,
    )


def _interview_fit(analyses: list[Analysis]) -> InterviewFit | None:
    if not analyses:
        return None
    latest_by_iv: dict[int | None, Analysis] = {}
    for a in sorted(analyses, key=lambda a: a.id):
        latest_by_iv[a.interview_id] = a
    items = list(latest_by_iv.values())
    n = len(items)
    newest = max(items, key=lambda a: a.id)
    tech = round(sum(a.technical_score for a in items) / n)
    comm = round(sum(a.communication_score for a in items) / n)
    conf = round(sum(a.confidence_score for a in items) / n)
    return InterviewFit(
        count=n, technical_score=tech, communication_score=comm, confidence_score=conf,
        aggregate=round((tech + comm + conf) / 3), latest_analysis_id=newest.id,
        recommendation=newest.hiring_recommendation,
    )


def _claims(analyses: list[Analysis]) -> ClaimChecks:
    out = ClaimChecks(verified=0, unclear=0, contradicted=0, flags=[])
    latest_by_iv: dict[int | None, Analysis] = {}
    for a in sorted(analyses, key=lambda a: a.id):
        latest_by_iv[a.interview_id] = a
    for a in latest_by_iv.values():
        for c in a.resume_alignment or []:
            verdict = c.get("verdict") or "unclear"
            if verdict in ("verified", "unclear", "contradicted"):
                setattr(out, verdict, getattr(out, verdict) + 1)
            if verdict == "contradicted" or (verdict == "unclear" and c.get("severity") == "high"):
                out.flags.append(
                    ClaimFlag(
                        claim=c.get("claim", ""), verdict=verdict, severity=c.get("severity", "low"),
                        segment_ids=c.get("segment_ids", []), interview_id=a.interview_id,
                    )
                )
    return out


def build_cards(
    db: Session, ctx: OrgContext, role_id: int, candidates: list[Candidate],
    matches: dict[int, RoleMatch],
) -> list[SummaryCard]:
    ids = [c.id for c in candidates]
    criteria = rubric_service.list_criteria(db, ctx.org_id, role_id)
    analyses: dict[int, list[Analysis]] = defaultdict(list)
    notes: dict[int, str] = {}
    if ids:
        for a in db.query(Analysis).filter(
            Analysis.org_id == ctx.org_id, Analysis.candidate_id.in_(ids),
            (Analysis.role_id == role_id) | (Analysis.role_id.is_(None)),
        ):
            analyses[a.candidate_id].append(a)
        rows = (
            db.query(Interview.candidate_id, InterviewNote.summary, InterviewNote.id)
            .join(InterviewNote, InterviewNote.interview_id == Interview.id)
            .filter(Interview.org_id == ctx.org_id, Interview.candidate_id.in_(ids))
            .order_by(InterviewNote.id)
            .all()
        )
        for cid, summary, _ in rows:
            notes[cid] = summary  # last (newest) wins
    blind = blind_enabled(ctx)
    shown = revealed_ids(db, ctx) if blind else set()
    cards = []
    for c in candidates:
        fit = _fit(matches.get(c.id), criteria)
        iv = _interview_fit(analyses.get(c.id, []))
        claims = _claims(analyses.get(c.id, []))
        high = sum(1 for f in claims.flags if f.verdict == "contradicted" and f.severity == "high")
        excerpt = notes.get(c.id)
        cards.append(
            SummaryCard(
                candidate=mini(c, blind and c.id not in shown),
                role_id=role_id, resume_fit=fit, interview=iv, claim_checks=claims,
                notes_excerpt=(excerpt[:300] + ("…" if len(excerpt) > 300 else "")) if excerpt else None,
                suggestion=suggest(fit, iv, high),
            )
        )
    return cards


def summary_card(db: Session, ctx: OrgContext, candidate_id: int, role_id: int | None) -> SummaryCard:
    cand = candidate_service.get_candidate(db, ctx, candidate_id)
    rid = role_id or cand.role_id
    role_service.get_role(db, ctx, rid)
    m = (
        db.query(RoleMatch)
        .filter(RoleMatch.org_id == ctx.org_id, RoleMatch.candidate_id == cand.id, RoleMatch.role_id == rid)
        .first()
    )
    card = build_cards(db, ctx, rid, [cand], {cand.id: m} if m else {})[0]
    if not card.candidate.blind:
        audit_service.record(db, ctx, "candidate.viewed", "candidate", cand.id, via="summary_card")
        db.commit()
    return card


# ── rankings ──────────────────────────────────────────────────────────────────
def rankings(
    db: Session,
    ctx: OrgContext,
    role_id: int,
    must_haves_met: bool | None = None,
    min_score: float | None = None,
    max_score: float | None = None,
    stage: str | None = None,
    interviewed: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> RankingPage:
    role_service.get_role(db, ctx, role_id)
    visible = {c.id for c in candidate_service._query(db, ctx).all()}  # honours interviewer scoping
    q = db.query(RoleMatch).filter(RoleMatch.org_id == ctx.org_id, RoleMatch.role_id == role_id)
    ms = [m for m in q.all() if m.candidate_id in visible]
    if must_haves_met is True:
        ms = [m for m in ms if not m.must_have_failed and m.status == "scored"]
    elif must_haves_met is False:
        ms = [m for m in ms if m.must_have_failed]
    if min_score is not None:
        ms = [m for m in ms if m.overall_score is not None and m.overall_score >= min_score]
    if max_score is not None:
        ms = [m for m in ms if m.overall_score is not None and m.overall_score <= max_score]
    cands = {
        c.id: c
        for c in db.query(Candidate).filter(
            Candidate.org_id == ctx.org_id, Candidate.id.in_([m.candidate_id for m in ms] or [0])
        )
    }
    if stage:
        ms = [m for m in ms if cands[m.candidate_id].status == stage]
    if interviewed is not None:
        has = {
            r[0]
            for r in db.query(Analysis.candidate_id).filter(
                Analysis.org_id == ctx.org_id,
                Analysis.candidate_id.in_([m.candidate_id for m in ms] or [0]),
            )
        }
        ms = [m for m in ms if (m.candidate_id in has) == interviewed]
    ms.sort(
        key=lambda m: (
            m.overall_score is None, -(m.overall_score or 0), -(m.vector_similarity or 0), m.id
        )
    )
    total = len(ms)
    page = ms[offset : offset + limit]
    cards = build_cards(db, ctx, role_id, [cands[m.candidate_id] for m in page], {m.candidate_id: m for m in page})
    job = job_service.latest(db, ctx.org_id, "rank", "role", role_id)
    res = job.result or {} if job else {}
    return RankingPage(
        items=cards, total=total, offset=offset, limit=limit,
        scored_count=sum(1 for m in ms if m.status == "scored"),
        rank_status=job.status if job else "none", rank_error=job.error if job and job.status == "failed" else None,
        rank_progress={"total": res.get("total"), "scored": res.get("scored"), "failed": res.get("failed")} if job else None,
        cost_usd=res.get("cost_usd") if job and job.status == "completed" else _running_cost(db, ctx, job),
    )


def _running_cost(db: Session, ctx: OrgContext, job) -> float | None:
    if job is None:
        return None
    from app.models.ai_run import AIRun

    rows = db.query(AIRun.cost_usd).filter(AIRun.org_id == ctx.org_id, AIRun.job_id == job.id).all()
    return float(sum(r[0] or 0 for r in rows))


# ── candidate matches (cross-role) ────────────────────────────────────────────
def candidate_matches(db: Session, ctx: OrgContext, candidate_id: int) -> list[MatchOut]:
    from app.models.role import Role

    cand = candidate_service.get_candidate(db, ctx, candidate_id)
    rows = (
        db.query(RoleMatch, Role)
        .join(Role, Role.id == RoleMatch.role_id)
        .filter(RoleMatch.org_id == ctx.org_id, RoleMatch.candidate_id == cand.id, Role.status == "open")
        .all()
    )
    out = []
    for m, role in rows:
        strong = (m.overall_score is not None and m.overall_score >= 70 and not m.must_have_failed) or (
            m.overall_score is None and (m.vector_similarity or 0) >= settings.cross_role_strong_similarity
        )
        out.append(
            MatchOut(
                role_id=role.id, role_name=role.name, is_primary=role.id == cand.role_id,
                status=m.status, overall_score=m.overall_score, vector_similarity=m.vector_similarity,
                must_have_failed=bool(m.must_have_failed), strong=strong,
            )
        )
    out.sort(key=lambda x: (x.overall_score is None, -(x.overall_score or 0), -(x.vector_similarity or 0)))
    return out


# ── compare ───────────────────────────────────────────────────────────────────
def compare(db: Session, ctx: OrgContext, role_id: int, candidate_ids: list[int]) -> CompareMatrix:
    ids = list(dict.fromkeys(candidate_ids))
    if not 2 <= len(ids) <= 4:
        raise Invalid("Select 2 to 4 candidates to compare", "bad_selection")
    role_service.get_role(db, ctx, role_id)
    cands = [candidate_service.get_candidate(db, ctx, i) for i in ids]
    ms = {
        m.candidate_id: m
        for m in db.query(RoleMatch).filter(
            RoleMatch.org_id == ctx.org_id, RoleMatch.role_id == role_id, RoleMatch.candidate_id.in_(ids)
        )
    }
    cards = build_cards(db, ctx, role_id, cands, ms)
    criteria = rubric_service.list_criteria(db, ctx.org_id, role_id)

    def row(key, label, kind, cells, higher_is_better=True):
        vals = [c.value for c in cells if c.value is not None]
        best = []
        if vals:
            target = max(vals) if higher_is_better else min(vals)
            best = [c.candidate_id for c in cells if c.value == target] if len(set(vals)) > 1 else []
        return CompareRow(key=key, label=label, kind=kind, cells=cells, best_candidate_ids=best)

    rows = [
        row(
            "overall", "Resume fit", "resume",
            [CompareRowCell(candidate_id=c.candidate.id, value=(c.resume_fit.overall_score if c.resume_fit else None)) for c in cards],
        )
    ]
    for crit in criteria:
        cells = []
        for c in cards:
            cr = next((x for x in (c.resume_fit.criteria if c.resume_fit else []) if x.criterion_id == crit.id), None)
            cells.append(CompareRowCell(candidate_id=c.candidate.id, value=cr.score if cr else None, evidence=cr.evidence if cr else []))
        rows.append(row(f"criterion:{crit.id}", crit.name, "criterion", cells))
    for key, label, attr in (
        ("technical", "Technical", "technical_score"),
        ("communication", "Communication", "communication_score"),
        ("confidence", "Confidence", "confidence_score"),
    ):
        rows.append(
            row(key, label, "interview",
                [CompareRowCell(candidate_id=c.candidate.id, value=getattr(c.interview, attr) if c.interview else None) for c in cards])
        )
    rows.append(
        row("contradicted", "Contradicted claims", "claims",
            [CompareRowCell(candidate_id=c.candidate.id, value=c.claim_checks.contradicted) for c in cards],
            higher_is_better=False)
    )
    return CompareMatrix(role_id=role_id, candidates=[c.candidate for c in cards], rows=rows,
                         suggestions={c.candidate.id: c.suggestion for c in cards})
