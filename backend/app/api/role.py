from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.dependencies import get_db

from app.models.role import Role

from app.schemas.role import (
    RoleCreate,
    RoleResponse
)

from app.models.candidate import Candidate

router = APIRouter(
    prefix="/roles",
    tags=["Roles"]
)

@router.post(
    "/",
    response_model=RoleResponse
)
async def create_role(
    role: RoleCreate,
    db: Session = Depends(get_db)
):
    new_role = Role(
        name=role.name,
        experience_level=role.experience_level,
        experience_required_years=role.experience_required_years
    )

    db.add(new_role)

    db.commit()

    db.refresh(new_role)

    return new_role

@router.get(
    "/",
    response_model=list[RoleResponse]
)
async def list_roles(
    db:Session = Depends(get_db)

):
    roles = db.query(Role).all()

    return roles


@router.delete("/{role_id}", status_code=204)
async def delete_role(
    role_id: int,
    db: Session = Depends(get_db)
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    # Prevent deletion if candidates are linked
    count = db.query(Candidate).filter(Candidate.role_id == role_id).count()
    if count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete role: {count} candidate(s) are assigned to it. Reassign or remove them first."
        )

    db.delete(role)
    db.commit()
