from fastapi import (
    APIRouter,
    Depends, 
    HTTPException,
    UploadFile,
    File
)
from sqlalchemy.orm import Session

from app.db.dependencies import get_db

from app.models.candidate import Candidate
from app.models.role import Role

from app.schemas.candidate import (
    CandidateCreate,
    CandidateResponse
)

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
        role_id=candidate.role_id
    )

    db.add(new_candidate)

    db.commit()

    db.refresh(new_candidate)

    return new_candidate


@router.get(
    "/role/{role_id}",
    response_model=list[CandidateResponse]
)
async def get_candidates_by_role(
    role_id: int,
    db: Session = Depends(get_db)
):

    candidates=db.query(Candidate).filter(
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