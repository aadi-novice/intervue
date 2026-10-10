"""Resume parsing: text extraction -> structured profile (cached by content hash)."""

import hashlib

from sqlalchemy.orm import Session

from app.ai.extractor import extract_text_from_pdf
from app.ai.resume_parser import extract_resume_profile
from app.core.errors import Invalid, NotFound
from app.models.candidate import Candidate
from app.models.resume_profile import ResumeProfile


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
    if existing and existing.content_hash == content_hash:
        return existing

    parsed = extract_resume_profile(text, org_id)
    if existing is None:
        existing = ResumeProfile(org_id=org_id, candidate_id=cand.id)
        db.add(existing)
    existing.basics = parsed["basics"]
    existing.summary = parsed["summary"]
    existing.education = parsed["education"]
    existing.experience = parsed["experience"]
    existing.projects = parsed["projects"]
    existing.skills = parsed["skills"]
    existing.metadata_ = parsed["metadata"]
    existing.content_hash = content_hash
    existing.embedding = None  # re-embedded by the ranking pipeline (M5.3)
    db.commit()
    db.refresh(existing)
    return existing
