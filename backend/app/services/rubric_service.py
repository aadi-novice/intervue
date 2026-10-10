"""Rubric CRUD, hashing, and the async "suggest rubric from JD" job."""

import hashlib
import json

from sqlalchemy.orm import Session

from app.ai import llm
from app.ai.prompts import rubric_suggest_v1 as prompt
from app.ai.schemas import RubricSuggestOut
from app.api.deps import OrgContext
from app.core.errors import Invalid
from app.models.rubric import RubricCriterion
from app.services import audit_service, job_service, role_service

MAX_CRITERIA = 12
SUGGEST_KIND = "rubric_suggest"


def list_criteria(db: Session, org_id: int, role_id: int) -> list[RubricCriterion]:
    return (
        db.query(RubricCriterion)
        .filter(RubricCriterion.org_id == org_id, RubricCriterion.role_id == role_id)
        .order_by(RubricCriterion.position, RubricCriterion.id)
        .all()
    )


def rubric_hash(criteria: list[RubricCriterion]) -> str:
    payload = [
        [c.id, c.name, c.description, round(c.weight, 4), bool(c.must_have)] for c in criteria
    ]
    return hashlib.sha256(json.dumps(payload).encode()).hexdigest()


def put_rubric(db: Session, ctx: OrgContext, role_id: int, items: list[dict]) -> list[RubricCriterion]:
    """Replace the role's rubric. Items with an `id` are updated in place so existing role_match
    evidence keeps pointing at the right criterion. Weights are normalised to sum to 1."""
    role_service.get_role(db, ctx, role_id)
    if not items:
        raise Invalid("A rubric needs at least one criterion", "rubric_empty")
    if len(items) > MAX_CRITERIA:
        raise Invalid(f"At most {MAX_CRITERIA} criteria", "rubric_too_large")
    names = [i["name"].strip().lower() for i in items]
    if any(not n for n in names) or len(set(names)) != len(names):
        raise Invalid("Criterion names must be non-empty and unique", "rubric_names")
    total = sum(float(i["weight"]) for i in items)
    if total <= 0:
        raise Invalid("At least one criterion needs a positive weight", "rubric_weights")

    existing = {c.id: c for c in list_criteria(db, ctx.org_id, role_id)}
    keep: set[int] = set()
    result: list[RubricCriterion] = []
    for pos, it in enumerate(items):
        c = existing.get(it.get("id")) if it.get("id") else None
        if it.get("id") and c is None:
            raise Invalid("Unknown criterion id", "rubric_unknown_id")
        if c is None:
            c = RubricCriterion(org_id=ctx.org_id, role_id=role_id)
            db.add(c)
        else:
            keep.add(c.id)
        c.name = it["name"].strip()
        c.description = (it.get("description") or "").strip()
        c.weight = float(it["weight"]) / total
        c.must_have = bool(it.get("must_have"))
        c.position = pos
        result.append(c)
    for cid, c in existing.items():
        if cid not in keep:
            db.delete(c)
    audit_service.record(db, ctx, "rubric.updated", "role", role_id, criteria=len(items))
    db.commit()
    for c in result:
        db.refresh(c)
    return result


def request_suggestion(db: Session, ctx: OrgContext, role_id: int):
    role = role_service.get_role(db, ctx, role_id)
    if not (role.description or "").strip():
        raise Invalid("Add a job description first", "no_description")
    job = job_service.create(db, ctx.org_id, SUGGEST_KIND, "role", role.id)
    from app.worker.tasks.ranking import suggest_rubric_task

    suggest_rubric_task.delay(ctx.org_id, role.id, job.id)
    return job


def run_suggestion(db: Session, org_id: int, role_id: int, job_id: int) -> dict:
    from app.models.role import Role

    role = db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first()
    out: RubricSuggestOut = llm.complete_json(
        purpose="rubric_suggest",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(
            role.name, role.experience_level, role.experience_required_years, role.description or ""
        ),
        schema=RubricSuggestOut,
        org_id=org_id,
        job_id=job_id,
    )
    crit = [c for c in out.criteria if c.name.strip()][:MAX_CRITERIA]
    total = sum(max(c.weight, 0) for c in crit) or 1.0
    return {
        "criteria": [
            {
                "name": c.name.strip(),
                "description": c.description.strip(),
                "weight": round(max(c.weight, 0) / total, 4),
                "must_have": c.must_have,
            }
            for c in crit
        ]
    }
