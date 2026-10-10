from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.models.tenancy import AuditLog


def record(
    db: Session,
    ctx: OrgContext,
    action: str,
    entity_type: str | None = None,
    entity_id: int | str | None = None,
    **metadata,
) -> None:
    """Append an audit entry (committed with the caller's transaction)."""
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user.id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            metadata_=metadata,
        )
    )
