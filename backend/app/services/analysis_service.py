"""Interview analysis. Reads ONLY from transcript_segments (one code path)."""

import logging

from sqlalchemy.orm import Session

from app.ai.comparator import check_resume_claims
from app.ai.extractor import extract_text_from_pdf
from app.ai.summarizer import generate_interview_analysis, generate_interview_notes
from app.api.deps import OrgContext
from app.core.errors import Invalid, NotFound
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.interview import Interview, InterviewNote, TranscriptSegment
from app.models.job import Job
from app.models.role import Role
from app.services import audit_service, candidate_service, interview_service, job_service
from app.services import transcript_service

log = logging.getLogger(__name__)

JOB_KIND = "analysis"
SEGMENT_CITATION_LIMIT = 6


# ── requests (called from API handlers; never call an LLM) ────────────────────
def _check_ready(db: Session, org_id: int, iv: Interview) -> None:
    cand = db.get(Candidate, iv.candidate_id)
    if cand is None or not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    kinds = {
        k
        for (k,) in db.query(TranscriptSegment.speaker_kind)
        .filter(TranscriptSegment.interview_id == iv.id, TranscriptSegment.org_id == org_id)
        .distinct()
    }
    if not kinds:
        raise Invalid("Transcript not uploaded", "no_transcript")
    if "candidate" not in kinds:
        raise Invalid(
            "Map at least one speaker to the candidate before analysing",
            "speakers_unmapped",
        )


def request_interview_analysis(db: Session, ctx: OrgContext, interview_id: int) -> Job:
    iv = interview_service.get_interview(db, ctx, interview_id)
    _check_ready(db, ctx.org_id, iv)
    job = job_service.create(db, ctx.org_id, JOB_KIND, "interview", iv.id)
    audit_service.record(db, ctx, "analysis.requested", "interview", iv.id)
    db.commit()
    from app.worker.tasks.analysis import run_analysis_task

    run_analysis_task.delay(ctx.org_id, iv.id, job.id)
    return job


def latest_interview_for_candidate(db: Session, ctx: OrgContext, candidate_id: int) -> Interview:
    """Legacy `/analysis/candidates/{id}`: analyse the candidate's newest interview with a transcript."""
    cand = candidate_service.get_candidate(db, ctx, candidate_id)  # 404 / visibility
    if not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    with_segments = db.query(TranscriptSegment.interview_id).filter(
        TranscriptSegment.org_id == ctx.org_id
    )
    iv = (
        interview_service._visible(db, ctx)
        .filter(Interview.candidate_id == candidate_id, Interview.id.in_(with_segments))
        .order_by(Interview.id.desc())
        .first()
    )
    if iv is None:
        raise Invalid("Transcript not uploaded", "no_transcript")
    return iv


# ── worker side ───────────────────────────────────────────────────────────────
def _load(db: Session, org_id: int, interview_id: int):
    iv = db.query(Interview).filter(Interview.id == interview_id, Interview.org_id == org_id).first()
    if iv is None:
        raise NotFound("Interview not found")
    segs = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.interview_id == iv.id, TranscriptSegment.org_id == org_id)
        .order_by(TranscriptSegment.position)
        .all()
    )
    if not segs:
        raise Invalid("Transcript not uploaded", "no_transcript")
    return iv, segs


def generate_notes(db: Session, org_id: int, interview_id: int) -> InterviewNote:
    iv, segs = _load(db, org_id, interview_id)
    role = db.get(Role, iv.role_id) if iv.role_id else None
    out = generate_interview_notes(
        transcript_service.format_for_llm(segs), role.name if role else "the role", org_id
    )
    note = iv.notes or InterviewNote(org_id=org_id, interview_id=iv.id)
    note.summary = out.summary
    note.key_points = out.key_points
    note.topics = out.topics
    note.follow_ups = out.follow_ups
    note.model = "see ai_runs"
    note.prompt_version = "notes_v1"
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def _fmt_ids(ids: list[int], valid: set[int]) -> list[int]:
    """Keep only ids that exist in this transcript (drop hallucinated citations)."""
    seen, out = set(), []
    for i in ids:
        if i in valid and i not in seen:
            seen.add(i)
            out.append(i)
    return out[:SEGMENT_CITATION_LIMIT]


def analyze_interview(db: Session, org_id: int, interview_id: int) -> Analysis:
    iv, segs = _load(db, org_id, interview_id)
    cand = db.get(Candidate, iv.candidate_id)
    if cand is None or not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    candidate_ids = {s.id for s in segs if s.speaker_kind == "candidate"}
    if not candidate_ids:
        raise Invalid("Map at least one speaker to the candidate before analysing", "speakers_unmapped")
    all_ids = {s.id for s in segs}

    resume_text = extract_text_from_pdf(cand.resume_path)
    transcript_text = transcript_service.format_for_llm(segs)

    summary = generate_interview_analysis(resume_text, transcript_text, org_id)
    claims = check_resume_claims(resume_text, transcript_text, org_id)

    # Evidence or it didn't happen: strengths/weaknesses/moments must cite real candidate lines.
    def cited(points):
        out = []
        for p in points:
            ids = _fmt_ids(p.segment_ids, candidate_ids)
            if ids:
                out.append({"text": p.text, "segment_ids": ids})
        return out

    moments = [
        {"moment": m.moment, "signal": m.signal, "segment_id": m.segment_id}
        for m in summary.key_moments
        if m.segment_id in all_ids
    ]
    seg_by_id = {s.id: s for s in segs}
    for m in moments:
        m["timestamp_ms"] = seg_by_id[m["segment_id"]].start_ms

    alignment = []
    for c in claims.comparisons:
        ids = _fmt_ids(c.segment_ids, candidate_ids)
        verdict = c.verdict
        if verdict in ("verified", "contradicted") and not ids:
            verdict = "unclear"  # no citable candidate evidence -> cannot assert either way
        alignment.append(
            {
                "claim": c.claim,
                "resume_quote": c.resume_quote,
                "verdict": verdict,
                "result": c.explanation,  # kept for older clients
                "severity": c.severity,
                "segment_ids": ids,
            }
        )

    from app.ai.prompts import analysis_v2

    analysis = Analysis(
        org_id=org_id,
        candidate_id=cand.id,
        interview_id=iv.id,
        role_id=iv.role_id or cand.role_id,
        summary=summary.summary,
        strengths=cited(summary.strengths),
        weaknesses=cited(summary.weaknesses),
        key_moments=moments,
        resume_alignment=alignment,
        technical_score=max(0, min(100, summary.technical_score)),
        communication_score=max(0, min(100, summary.communication_score)),
        confidence_score=max(0, min(100, summary.confidence_score)),
        hiring_recommendation=summary.hiring_recommendation,
        prompt_version=analysis_v2.VERSION,
    )
    db.add(analysis)
    iv.status = "completed"
    db.commit()
    db.refresh(analysis)
    return analysis


def process_interview(db: Session, org_id: int, interview_id: int) -> Analysis | None:
    """Notes then analysis. Notes failing must not block the analysis."""
    try:
        generate_notes(db, org_id, interview_id)
    except Exception:
        db.rollback()
        log.exception("notes generation failed for interview %s", interview_id)
    return analyze_interview(db, org_id, interview_id)
