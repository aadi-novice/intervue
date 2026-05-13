from fastapi import (
    APIRouter,
    Depends,
    HTTPException
)

from sqlalchemy.orm import Session

from app.db.dependencies import get_db

from app.schemas.analysis import (
    AnalysisResponse
)

from app.services.analysis_service import (
    analyze_candidate
)


router = APIRouter(
    prefix="/analysis",
    tags=["Analysis"]
)


@router.post(
    "/candidates/{candidate_id}",
    response_model=AnalysisResponse
)
async def analyze_candidate_route(
    candidate_id: int,
    db: Session = Depends(get_db)
):

    try:

        analysis = analyze_candidate(
            candidate_id,
            db
        )

        return analysis

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )