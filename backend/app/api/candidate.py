from fastapi import (
    APIRouter,
    Depends, 
    HTTPException,
    UploadFile,
    File
)
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Literal
from datetime import datetime, timezone

from app.db.dependencies import get_db

from app.models.candidate import Candidate
from app.models.role import Role
from app.models.analysis import Analysis

from app.schemas.candidate import (
    CandidateCreate,
    CandidateResponse,
    PipelineCandidateResponse,
    CandidateDetailResponse,
    AnalysisSummary,
    ResumeProfileSummary,
    STAGE_COLORS,
)

VALID_STATUSES = ["applied", "screening", "interview", "offer", "hired"]

class StatusUpdate(BaseModel):
    status: Literal["applied", "screening", "interview", "offer", "hired"]

from app.models.resume_profile import ResumeProfile

from app.ai.resume_parser import extract_resume_profile

from app.ai.transcript_loader import (
    load_transcript
)

from app.ai.transcript_parser import (
    chunk_transcript
)

from app.ai.extractor import extract_text_from_pdf

from app.utils.file_handler import save_file

router = APIRouter(
    prefix="/candidates",
    tags=["candidates"]
)

@router.post(
    "/",
    response_model=CandidateResponse
)
async def create_candidate(
    candidate: CandidateCreate,
    db: Session = Depends(get_db)
):
    role = db.query(Role).filter(
        Role.id == candidate.role_id
    ).first()

    if not role: raise HTTPException(
        status_code=404,
        detail="Role not found"
    )

    new_candidate = Candidate(
        name=candidate.name,
        email=candidate.email,
        phone=candidate.phone,
        role_id=candidate.role_id
    )

    db.add(new_candidate)

    db.commit()

    db.refresh(new_candidate)

    return new_candidate


@router.get(
    "/",
    response_model=list[PipelineCandidateResponse]
)
async def list_candidates(
    db: Session = Depends(get_db)
):
    candidates = db.query(Candidate).all()
    result = []
    for c in candidates:
        # ── Role name ──────────────────────────────────
        role = db.query(Role).filter(Role.id == c.role_id).first()
        role_name = role.name if role else "Unknown Role"

        # ── Analysis / score ───────────────────────────
        analyses = db.query(Analysis).filter(
            Analysis.candidate_id == c.id
        ).all()
        has_analysis = len(analyses) > 0
        if has_analysis:
            latest = analyses[-1]  # most recent
            score = round(
                (latest.technical_score + latest.communication_score + latest.confidence_score) / 3
            )
        else:
            score = 0

        # ── Derived fields ─────────────────────────────
        initials = "".join(part[0].upper() for part in c.name.split()[:2])
        stage = c.status if c.status in STAGE_COLORS else "applied"
        color = STAGE_COLORS[stage]
        now = datetime.now(timezone.utc)
        created = c.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        days = (now - created).days

        result.append(PipelineCandidateResponse(
            id=str(c.id),
            name=c.name,
            email=c.email,
            phone=c.phone,
            role=role_name,
            role_id=c.role_id,
            score=score,
            avatar=initials,
            color=color,
            days=days,
            ai=has_analysis,
            stage=stage,
            resume_path=c.resume_path,
            transcript_path=c.transcript_path,
        ))
    return result


@router.patch("/{candidate_id}/status", response_model=CandidateResponse)
async def update_candidate_status(
    candidate_id: int,
    payload: StatusUpdate,
    db: Session = Depends(get_db)
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate not found"
        )

    candidate.status = payload.status
    db.commit()
    db.refresh(candidate)
    return candidate


@router.delete("/{candidate_id}", status_code=204)
async def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db)
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    db.delete(candidate)
    db.commit()


@router.get(
    "/{candidate_id}",
    response_model=CandidateDetailResponse
)
async def get_candidate_detail(
    candidate_id: int,
    db: Session = Depends(get_db)
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # ── Role ────────────────────────────────────────────────────────────
    role = db.query(Role).filter(Role.id == candidate.role_id).first()
    role_name = role.name if role else "Unknown Role"

    # ── Derived identity fields ──────────────────────────────────────────
    stage = candidate.status if candidate.status in STAGE_COLORS else "applied"
    color = STAGE_COLORS[stage]
    initials = "".join(part[0].upper() for part in candidate.name.split()[:2])
    now = datetime.now(timezone.utc)
    created = candidate.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    days = (now - created).days

    # ── Latest analysis ──────────────────────────────────────────────────
    analyses = db.query(Analysis).filter(
        Analysis.candidate_id == candidate.id
    ).all()
    has_analysis = len(analyses) > 0
    analysis_out: AnalysisSummary | None = None
    if has_analysis:
        a = analyses[-1]
        agg = round(
            (a.technical_score + a.communication_score + a.confidence_score) / 3
        )
        analysis_out = AnalysisSummary(
            id=a.id,
            summary=a.summary,
            strengths=a.strengths,
            weaknesses=a.weaknesses,
            key_moments=a.key_moments or [],
            resume_alignment=a.resume_alignment or [],
            technical_score=a.technical_score,
            communication_score=a.communication_score,
            confidence_score=a.confidence_score,
            aggregate_score=agg,
            created_at=a.created_at,
        )

    # ── Resume profile (cached AI extraction) ───────────────────────────
    profile_row = db.query(ResumeProfile).filter(
        ResumeProfile.candidate_id == candidate.id
    ).first()

    profile_out: ResumeProfileSummary | None = None

    if profile_row:
        # Already extracted — serve from cache
        profile_out = ResumeProfileSummary(
            basics=profile_row.basics,
            summary=profile_row.summary,
            education=profile_row.education,
            experience=profile_row.experience,
            projects=profile_row.projects,
            skills=profile_row.skills,
            metadata=profile_row.metadata_,
        )
    elif candidate.resume_path:
        # First time — run AI extraction and cache result
        try:
            resume_text = extract_text_from_pdf(candidate.resume_path)
            parsed = extract_resume_profile(resume_text)
            new_profile = ResumeProfile(
                candidate_id=candidate.id,
                basics=parsed["basics"],
                summary=parsed["summary"],
                education=parsed["education"],
                experience=parsed["experience"],
                projects=parsed["projects"],
                skills=parsed["skills"],
                metadata_=parsed["metadata"],
            )
            db.add(new_profile)
            db.commit()
            db.refresh(new_profile)
            profile_out = ResumeProfileSummary(
                basics=new_profile.basics,
                summary=new_profile.summary,
                education=new_profile.education,
                experience=new_profile.experience,
                projects=new_profile.projects,
                skills=new_profile.skills,
                metadata=new_profile.metadata_,
            )
        except Exception:
            # Don't fail the whole request if AI extraction errors
            profile_out = None

    return CandidateDetailResponse(
        id=str(candidate.id),
        name=candidate.name,
        email=candidate.email,
        phone=candidate.phone,
        stage=stage,
        avatar=initials,
        color=color,
        days=days,
        ai=has_analysis,
        role_id=candidate.role_id,
        role=role_name,
        resume_path=candidate.resume_path,
        transcript_path=candidate.transcript_path,
        avatar_path=candidate.avatar_path,
        resume_profile=profile_out,
        analysis=analysis_out,
    )


@router.get(
    "/role/{role_id}",
    response_model=list[CandidateResponse]
)
async def get_candidates_by_role(
    role_id: int,
    db: Session = Depends(get_db)
):

    candidates = db.query(Candidate).filter(
        Candidate.role_id == role_id
    ).all()

    return candidates


@router.post("/{candidate_id}/resume")
async def upload_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate not found"
        )
    
    file_path  = save_file(
        file,
        "storage/resumes"
    )

    candidate.resume_path = file_path 
    
    db.commit()

    return{
        "message":"Resume uploaded successfully",
        "file_path":file_path
    }


@router.post("/{candidate_id}/transcript")
async def upload_transcript(
    candidate_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate not found"
        )

    file_path = save_file(
        file,
        "storage/transcripts"
    )

    candidate.transcript_path = file_path

    db.commit()

    return {
        "message": "Transcript uploaded successfully",
        "file_path": file_path
    }


@router.post("/{candidate_id}/avatar")
async def upload_avatar(
    candidate_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    file_path = save_file(file, "storage/avatars")
    candidate.avatar_path = file_path
    db.commit()

    return {
        "message": "Avatar uploaded successfully",
        "avatar_path": file_path
    }


@router.get("/{candidate_id}/resume-text")
async def get_resume_text(
    candidate_id: int,
    db: Session = Depends(get_db)
):

    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate not found"
        )

    if not candidate.resume_path:
        raise HTTPException(
            status_code=400,
            detail="Resume not uploaded"
        )

    extracted_text = extract_text_from_pdf(
        candidate.resume_path
    )

    return {
        "resume_text": extracted_text
    }

@router.get("/{candidate_id}/transcript-chunks")
async def get_transcript_chunks(
    candidate_id: int,
    db: Session = Depends(get_db)
):

    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id
    ).first()

    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate not found"
        )

    if not candidate.transcript_path:
        raise HTTPException(
            status_code=400,
            detail="Transcript not uploaded"
        )

    transcript_text = load_transcript(
        candidate.transcript_path
    )

    chunks = chunk_transcript(
        transcript_text
    )

    if not chunks:

        raise HTTPException(
            status_code=400,
            detail="Could not parse transcript format"
        )

    return {
        "chunks": chunks
    }