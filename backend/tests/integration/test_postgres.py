"""
Runs against a real PostgreSQL + pgvector (skipped unless PG_TEST_ADMIN_URL is set):

    PG_TEST_ADMIN_URL=postgresql+psycopg2://intervue:intervue123@localhost:5432/intervue_db \
        uv run pytest -m integration

Creates a throw-away database, applies the FULL migration chain, then exercises the pgvector
queries that the SQLite unit tests cannot.
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.integration

ADMIN_URL = os.environ.get("PG_TEST_ADMIN_URL")
BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def pg_url():
    if not ADMIN_URL:
        pytest.skip("PG_TEST_ADMIN_URL not set")
    name = f"intervue_pgtest_{uuid.uuid4().hex[:8]}"
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    env = {**os.environ, "DATABASE_URL": url}
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    yield url
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture()
def db(pg_url):
    engine = create_engine(pg_url)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


def vec(**hot) -> list[float]:
    """1536-d vector with a few non-zero dimensions (pgvector column is vector(1536))."""
    v = [0.0] * 1536
    for k, val in hot.items():
        v[int(k[1:])] = val
    return v


def seed(db, org_name="O"):
    from app.models.candidate import Candidate
    from app.models.resume_profile import ResumeProfile
    from app.models.role import Role
    from app.models.tenancy import Organization

    org = Organization(name=org_name, slug=f"{org_name}-{uuid.uuid4().hex[:6]}", settings={})
    db.add(org)
    db.flush()
    role = Role(org_id=org.id, name="R", experience_level="Mid", experience_required_years=1)
    db.add(role)
    db.flush()
    out = {"org": org, "role": role, "cands": {}}
    for key, v in (("rust", vec(d0=1.0)), ("mixed", vec(d0=1.0, d1=1.0)), ("sales", vec(d1=1.0))):
        c = Candidate(org_id=org.id, name=key, email=f"{key}@{org.slug}.com", role_id=role.id)
        db.add(c)
        db.flush()
        db.add(ResumeProfile(
            org_id=org.id, candidate_id=c.id, basics={}, summary="s", education=[], experience=[],
            projects=[], skills={}, metadata_={}, embedding=v,
        ))
        out["cands"][key] = c
    db.commit()
    return out


def test_migrations_produce_a_schema_matching_the_models(pg_url):
    env = {**os.environ, "DATABASE_URL": pg_url}
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "check"], cwd=BACKEND, env=env, capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_vector_indexes_exist(db):
    names = {r[0] for r in db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename IN ('roles','resume_profiles')"))}
    assert {"ix_roles_jd_embedding_hnsw", "ix_resume_profiles_embedding_hnsw"} <= names


def test_similar_resumes_orders_by_cosine_and_respects_k_and_org(db):
    from app.services import ranking_service

    a, b = seed(db, "A"), seed(db, "B")
    q = vec(d0=1.0)
    res = ranking_service.similar_resumes(db, a["org"].id, q, k=2)
    assert [cid for cid, _ in res] == [a["cands"]["rust"].id, a["cands"]["mixed"].id]
    assert res[0][1] == pytest.approx(1.0, abs=1e-5) and res[1][1] == pytest.approx(0.7071, abs=1e-3)
    # never returns the other org's resumes
    assert all(cid in {c.id for c in a["cands"].values()} for cid, _ in ranking_service.similar_resumes(db, a["org"].id, q, k=50))
    assert len(ranking_service.similar_resumes(db, b["org"].id, q, k=50)) == 3


def test_similar_roles_only_open_with_embeddings(db):
    from app.models.role import Role
    from app.services import ranking_service

    s = seed(db, "C")
    org_id = s["org"].id
    db.add_all([
        Role(org_id=org_id, name="open-rust", experience_level="x", experience_required_years=0, status="open", jd_embedding=vec(d0=1.0)),
        Role(org_id=org_id, name="closed-rust", experience_level="x", experience_required_years=0, status="closed", jd_embedding=vec(d0=1.0)),
        Role(org_id=org_id, name="no-embedding", experience_level="x", experience_required_years=0, status="open"),
    ])
    db.commit()
    got = ranking_service.similar_roles(db, org_id, vec(d0=1.0), k=10)
    names = {db.get(Role, rid).name for rid, _ in got}
    assert names == {"open-rust"}


def test_null_embedding_is_sql_null_not_json_null(db):
    from app.models.resume_profile import ResumeProfile

    s = seed(db, "D")
    p = db.query(ResumeProfile).filter_by(candidate_id=s["cands"]["rust"].id).one()
    p.embedding = None
    db.commit()
    assert db.execute(text("SELECT embedding IS NULL FROM resume_profiles WHERE id = :i"), {"i": p.id}).scalar() is True
    assert db.query(ResumeProfile).filter(ResumeProfile.embedding.is_(None), ResumeProfile.org_id == s["org"].id).count() == 1


def test_per_org_uniqueness_is_enforced_by_the_database(db):
    from sqlalchemy.exc import IntegrityError

    from app.models.candidate import Candidate

    a, b = seed(db, "E"), seed(db, "F")
    # same email in two orgs is fine...
    db.add(Candidate(org_id=b["org"].id, name="x", email=a["cands"]["rust"].email, role_id=b["role"].id))
    db.commit()
    # ...but not twice in one org
    db.add(Candidate(org_id=a["org"].id, name="dup", email=a["cands"]["rust"].email, role_id=a["role"].id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_cascade_delete_of_candidate_removes_dependents(db):
    from app.models.analysis import Analysis
    from app.models.resume_profile import ResumeProfile

    s = seed(db, "G")
    c = s["cands"]["rust"]
    db.add(Analysis(org_id=s["org"].id, candidate_id=c.id, summary="s", strengths=[], weaknesses=[],
                    technical_score=1, communication_score=1, confidence_score=1))
    db.commit()
    db.delete(c)
    db.commit()
    assert db.query(Analysis).filter_by(candidate_id=c.id).count() == 0
    assert db.query(ResumeProfile).filter_by(candidate_id=c.id).count() == 0
