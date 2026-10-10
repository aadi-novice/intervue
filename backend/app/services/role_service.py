from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.errors import Conflict, NotFound
from app.models.candidate import Candidate
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate


def get_role(db: Session, ctx: OrgContext, role_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id, Role.org_id == ctx.org_id).first()
    if role is None:
        raise NotFound("Role not found")
    return role


def list_roles(db: Session, ctx: OrgContext) -> list[Role]:
    return db.query(Role).filter(Role.org_id == ctx.org_id).order_by(Role.id).all()


def create_role(db: Session, ctx: OrgContext, data: RoleCreate) -> Role:
    role = Role(org_id=ctx.org_id, **data.model_dump())
    db.add(role)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("A role with this name already exists", "role_exists")
    db.refresh(role)
    if role.description:
        _enqueue_embed(ctx.org_id, role.id)
    return role


def _enqueue_embed(org_id: int, role_id: int) -> None:
    from app.worker.tasks.ranking import embed_role_task

    embed_role_task.delay(org_id, role_id)


def update_role(db: Session, ctx: OrgContext, role_id: int, data: RoleUpdate) -> Role:
    role = get_role(db, ctx, role_id)
    changes = data.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(role, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("A role with this name already exists", "role_exists")
    db.refresh(role)
    if "description" in changes or "name" in changes:
        _enqueue_embed(ctx.org_id, role.id)
    return role


def delete_role(db: Session, ctx: OrgContext, role_id: int) -> None:
    role = get_role(db, ctx, role_id)
    count = (
        db.query(Candidate)
        .filter(Candidate.role_id == role_id, Candidate.org_id == ctx.org_id)
        .count()
    )
    if count:
        raise Conflict(
            f"Cannot delete role: {count} candidate(s) are assigned to it. "
            "Reassign or remove them first.",
            "role_has_candidates",
        )
    db.delete(role)
    db.commit()
