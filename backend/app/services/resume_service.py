"""Resume parsing: text extraction -> structured profile (cached by content hash) -> index."""

import hashlib

from sqlalchemy.orm import Session

from app.ai.extractor import extract_text_from_pdf
from app.ai.resume_parser import extract_resume_profile
from app.core.errors import Invalid, NotFound
from app.models.candidate import Candidate
from app.models.resume_profile import ResumeProfile


def save_profile(
    db: Session, org_id: int, cand: Candidate, text: str, content_hash: str, parsed: dict
) -> ResumeProfile:
    prof = cand.resume_profile
    if prof is None:
        prof = ResumeProfile(org_id=org_id, candidate_id=cand.id)
        db.add(prof)
    prof.basics = parsed["basics"]
    prof.summary = parsed["summary"]
    prof.education = parsed["education"]
    prof.experience = parsed["experience"]
    prof.projects = parsed["projects"]
    prof.skills = parsed["skills"]
    prof.metadata_ = parsed["metadata"]
    prof.content_hash = content_hash
    prof.raw_text = text
    prof.embedding = None  # re-embedded by index_candidate
    db.commit()
    db.refresh(prof)
    return prof


def parse_resume(db: Session, org_id: int, candidate_id: int) -> ResumeProfile:
    cand = (
        db.query(Candidate)
        .filter(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .first()
    )
    if cand is None:
        raise NotFound("Candidate not found")
    if not cand.resume_path:
        raise Invalid("Resume not uploaded", "no_resume")

    text = extract_text_from_pdf(cand.resume_path)
    if not text:
        raise Invalid("Could not extract any text from the resume", "empty_resume")
    content_hash = hashlib.sha256(text.encode()).hexdigest()

    existing = cand.resume_profile
    if existing and existing.content_hash == content_hash and existing.raw_text:
        return existing

    parsed = extract_resume_profile(text, org_id)
    prof = save_profile(db, org_id, cand, text, content_hash, parsed)

    # embed + cross-role similarity, then a debounced re-rank for the candidate's role
    from app.services import ranking_service

    ranking_service.index_candidate(db, org_id, cand.id)
    ranking_service.schedule_rank(org_id, cand.role_id)
    return prof
