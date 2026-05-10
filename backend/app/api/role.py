from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.dependencies import get_db

from app.models.role import Role

from app.schemas.role import (
    RoleCreate,
    RoleResponse
)

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
