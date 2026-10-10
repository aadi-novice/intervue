from sqlalchemy.orm import Session

from app.ai.comparator import compare_resume_and_transcript
from app.ai.extractor import extract_text_from_pdf
from app.ai.summarizer import generate_candidate_analysis
from app.ai.transcript_loader import load_transcript
from app.ai.transcript_parser import chunk_transcript
from app.api.deps import OrgContext
from app.core.errors import Invalid, NotFound
from app.models.analysis import Analysis
from app.models.candidate import Candidate
from app.models.job import Job
from app.services import audit_service, candidate_service, job_service

JOB_KIND = "analysis"


def request_analysis(db: Session, ctx: OrgContext, candidate_id: int) -> Job:
    """Validate inputs, create a job and enqueue it. Never calls an LLM."""
    cand = candidate_service.get_candidate(db, ctx, candidate_id)
    if not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    if not cand.transcript_path:
        raise Invalid("Transcript not uploaded", "no_transcript")
    job = job_service.create(db, ctx.org_id, JOB_KIND, "candidate", cand.id)
    audit_service.record(db, ctx, "analysis.requested", "candidate", cand.id)
    db.commit()
    from app.worker.tasks.analysis import run_analysis_task

    run_analysis_task.delay(ctx.org_id, cand.id, job.id)
    return job


def analyze_candidate(db: Session, org_id: int, candidate_id: int) -> Analysis:
    """Run the full analysis (called from the worker)."""
    cand = (
        db.query(Candidate)
        .filter(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .first()
    )
    if cand is None:
        raise NotFound("Candidate not found")
    if not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")
    if not cand.transcript_path:
        raise Invalid("Transcript not uploaded", "no_transcript")

    resume_text = extract_text_from_pdf(cand.resume_path)
    chunks = chunk_transcript(load_transcript(cand.transcript_path))
    if not chunks:
        raise Invalid("Could not parse transcript format", "unparseable_transcript")
    transcript_text = "\n".join(f"[{c['timestamp']}] {c['speaker']}: {c['text']}" for c in chunks)

    summary = generate_candidate_analysis(resume_text, transcript_text, org_id)
    comparison = compare_resume_and_transcript(resume_text, transcript_text, org_id)

    analysis = Analysis(
        org_id=org_id,
        candidate_id=cand.id,
        role_id=cand.role_id,
        summary=summary["summary"],
        strengths=summary["strengths"],
        weaknesses=summary["weaknesses"],
        key_moments=summary["key_moments"],
        technical_score=summary["technical_score"],
        communication_score=summary["communication_score"],
        confidence_score=summary["confidence_score"],
        hiring_recommendation=summary["hiring_recommendation"],
        resume_alignment=comparison["comparisons"],
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return analysis
