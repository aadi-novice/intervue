from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.analysis import Analysis

from app.ai.extractor import extract_text_from_pdf

from app.ai.transcript_loader import (
    load_transcript
)

from app.ai.transcript_parser import (
    chunk_transcript
)

from app.ai.summarizer import (
    generate_candidate_analysis
)

from app.ai.comparator import (
    compare_resume_and_transcript
)



def analyze_candidate(
    candidate_id: int,
    db: Session
):

    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise Exception("Candidate not found")

    if not candidate.resume_path:
        raise Exception("Resume not uploaded")

    if not candidate.transcript_path:
        raise Exception("Transcript not uploaded")

    # Resume Extraction
    resume_text = extract_text_from_pdf(
        candidate.resume_path
    )

    # Transcript Processing
    transcript_text = load_transcript(
        candidate.transcript_path
    )

    transcript_chunks = chunk_transcript(
        transcript_text
    )

    # AI Summary
    summary_data = generate_candidate_analysis(
        resume_text,
        transcript_chunks
    )

    # Comparator
    comparison_data = compare_resume_and_transcript(
        resume_text,
        transcript_chunks
    )

    comparisons = comparison_data.get("comparisons", comparison_data)

    # Persist Analysis
    analysis = Analysis(
        summary=summary_data["summary"],

        strengths=summary_data["strengths"],

        weaknesses=summary_data["weaknesses"],

        technical_score=summary_data["technical_score"],

        communication_score=summary_data["communication_score"],

        confidence_score=summary_data["confidence_score"],

        key_moments=summary_data["key_moments"],

        resume_alignment=comparisons,

        candidate_id=candidate.id
    )

    db.add(analysis)

    db.commit()

    db.refresh(analysis)

    return analysis