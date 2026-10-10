from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context, require_role
from app.db.dependencies import get_db
from app.schemas.role import RoleCreate, RoleResponse, RoleUpdate
from app.services import role_service

router = APIRouter(prefix="/roles", tags=["Roles"])


@router.post("/", response_model=RoleResponse)
def create_role(
    body: RoleCreate,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return role_service.create_role(db, ctx, body)


@router.get("/", response_model=list[RoleResponse])
def list_roles(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return role_service.list_roles(db, ctx)


@router.get("/{role_id}", response_model=RoleResponse)
def get_role(role_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return role_service.get_role(db, ctx, role_id)


@router.patch("/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    body: RoleUpdate,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    return role_service.update_role(db, ctx, role_id, body)


@router.delete("/{role_id}", status_code=204)
def delete_role(
    role_id: int,
    ctx: OrgContext = Depends(require_role("recruiter")),
    db: Session = Depends(get_db),
):
    role_service.delete_role(db, ctx, role_id)
    return Response(status_code=204)
