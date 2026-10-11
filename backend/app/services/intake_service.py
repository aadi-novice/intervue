"""Bulk resume intake (M5.2): uploads (PDF/DOCX or ZIP) -> per-file tasks -> candidates."""

import hashlib
import io
import re
import zipfile

from fastapi import UploadFile
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.ai.extractor import extract_text_from_bytes
from app.ai.resume_parser import cache_key_for, extract_resume_profile
from app.api.deps import OrgContext
from app.core import storage
from app.core.errors import Invalid, NotFound
from app.models.candidate import Candidate
from app.models.resume_profile import ResumeProfile
from app.models.role import Role
from app.models.rubric import IntakeBatch
from app.services import audit_service, ranking_service, role_service
from app.utils.file_handler import detect_ext

MAX_FILES = 500
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_UPLOAD_BYTES = 300 * 1024 * 1024  # all files of one request
MAX_UNZIPPED_BYTES = 400 * 1024 * 1024  # zip-bomb guard
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_ERRORS = 100


# ── request side ──────────────────────────────────────────────────────────────
def _is_zip(data: bytes) -> bool:
    if not data.startswith(b"PK\x03\x04"):
        return False
    try:
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
    except zipfile.BadZipFile:
        return False
    return not any(n == "word/document.xml" for n in names)  # a DOCX is also a zip


def create_batch(db: Session, ctx: OrgContext, role_id: int, files: list[UploadFile]) -> IntakeBatch:
    role_service.get_role(db, ctx, role_id)
    if not files:
        raise Invalid("No files uploaded", "no_files")
    if len(files) > MAX_FILES:
        raise Invalid(f"At most {MAX_FILES} files per upload", "too_many_files")
    keys: list[str] = []
    total_bytes = 0
    for f in files:
        f.file.seek(0)
        data = f.file.read(MAX_UPLOAD_BYTES + 1)
        total_bytes += len(data)
        if not data or len(data) > (MAX_UPLOAD_BYTES if data[:2] == b"PK" else MAX_FILE_BYTES) or total_bytes > MAX_UPLOAD_BYTES:
            raise Invalid(f"File '{f.filename}' is empty or too large", "bad_file_size")
        ext = "zip" if _is_zip(data) else detect_ext(data, "resumes")
        if ext is None:
            raise Invalid(f"'{f.filename}' is not a PDF, DOCX or ZIP", "unsupported_file")
        keys.append(storage.put(storage.make_key(ctx.org_id, "resumes", ext), data, f.content_type or "application/octet-stream"))
    batch = IntakeBatch(org_id=ctx.org_id, role_id=role_id, total=0, status="queued", errors=[])
    db.add(batch)
    audit_service.record(db, ctx, "resumes.bulk_uploaded", "role", role_id, files=len(files))
    db.commit()
    db.refresh(batch)
    from app.worker.tasks.ranking import start_batch_task

    start_batch_task.delay(ctx.org_id, batch.id, keys)
    return batch


def get_batch(db: Session, ctx: OrgContext, batch_id: int) -> IntakeBatch:
    b = db.query(IntakeBatch).filter(IntakeBatch.id == batch_id, IntakeBatch.org_id == ctx.org_id).first()
    if b is None:
        raise NotFound("Batch not found")
    return b


# ── worker side ───────────────────────────────────────────────────────────────
def _add_error(batch: IntakeBatch, file: str, status: str, detail: str) -> None:
    errs = list(batch.errors or [])
    if len(errs) < MAX_ERRORS:
        errs.append({"file": file, "status": status, "detail": detail[:300]})
        batch.errors = errs


def expand(db: Session, org_id: int, batch_id: int, keys: list[str]) -> list[str]:
    """Unzip uploaded archives into individual resume objects; returns the file keys to process."""
    batch = db.get(IntakeBatch, batch_id)
    out: list[str] = []
    for key in keys:
        data = storage.get(key)
        if not data.startswith(b"PK\x03\x04") or not _is_zip(data):
            out.append(key)
            continue
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
            infos = [
                i for i in zf.infolist()
                if not i.is_dir() and not i.filename.startswith("__MACOSX")
                and not i.filename.rsplit("/", 1)[-1].startswith(".")
                and i.filename.lower().endswith((".pdf", ".docx"))
            ]
            if sum(i.file_size for i in infos) > MAX_UNZIPPED_BYTES:
                _add_error(batch, key.rsplit("/", 1)[-1], "error", "archive expands to more than 400 MB")
                batch.failed += 1
                infos = []
            for info in infos:
                if len(out) >= MAX_FILES:
                    _add_error(batch, info.filename, "skipped", f"over the {MAX_FILES}-file limit")
                    continue
                if info.file_size > MAX_FILE_BYTES:
                    _add_error(batch, info.filename, "error", "file larger than 10 MB")
                    batch.failed += 1
                    continue
                content = zf.read(info)
                ext = detect_ext(content, "resumes")
                if ext is None:
                    _add_error(batch, info.filename, "error", "not a PDF or DOCX")
                    batch.failed += 1
                    continue
                out.append(storage.put(storage.make_key(org_id, "resumes", ext), content, "application/octet-stream"))
        except zipfile.BadZipFile:
            _add_error(batch, key, "error", "corrupt ZIP archive")
            batch.failed += 1
        finally:
            storage.delete(key)  # the archive itself is not kept
    batch.total = len(out) + batch.failed
    batch.status = "running" if out else "completed"
    db.commit()
    return out


def _email_from(profile: dict, text_hash: str) -> tuple[str, bool]:
    raw = ((profile.get("basics") or {}).get("email") or "").strip().lower()
    if _EMAIL.match(raw):
        return raw, True
    return f"no-email-{text_hash[:12]}@resume.invalid", False


def _finish_one(db: Session, org_id: int, batch_id: int, ok: bool) -> bool:
    """Atomically bump counters; returns True when this call completed the batch."""
    col = IntakeBatch.processed if ok else IntakeBatch.failed
    db.execute(update(IntakeBatch).where(IntakeBatch.id == batch_id).values({col.key: col + 1}))
    db.commit()
    b = db.get(IntakeBatch, batch_id)
    db.refresh(b)
    if b.processed + b.failed >= b.total and b.status != "completed":
        b.status = "completed"
        db.commit()
        return True
    return False


def process_file(db: Session, org_id: int, batch_id: int, key: str) -> None:
    batch = db.query(IntakeBatch).filter(IntakeBatch.id == batch_id, IntakeBatch.org_id == org_id).first()
    if batch is None:
        raise NotFound("Batch not found")
    ok = True
    try:
        _ingest(db, org_id, batch, key)
    except Invalid as e:
        db.rollback()
        batch = db.get(IntakeBatch, batch_id)
        _add_error(batch, key.rsplit("/", 1)[-1], "error", e.detail)
        db.commit()
        storage.delete(key)
        ok = False
    except Exception as e:  # unexpected: record, don't retry-storm 500 files
        db.rollback()
        batch = db.get(IntakeBatch, batch_id)
        _add_error(batch, key.rsplit("/", 1)[-1], "error", f"{type(e).__name__}: {e}")
        db.commit()
        ok = False
    if _finish_one(db, org_id, batch_id, ok):
        # one debounced re-rank for the whole batch
        ranking_service.schedule_rank(org_id, db.get(IntakeBatch, batch_id).role_id)


def _ingest(db: Session, org_id: int, batch: IntakeBatch, key: str) -> None:
    data = storage.get(key)
    text = extract_text_from_bytes(data, key)
    if not text.strip():
        raise Invalid("No text found (scanned image PDF?)", "empty_resume")
    content_hash = hashlib.sha256(text.encode()).hexdigest()

    dup = (
        db.query(ResumeProfile)
        .filter(ResumeProfile.org_id == org_id, ResumeProfile.content_hash == content_hash)
        .first()
    )
    if dup is not None:
        storage.delete(key)
        errs = list(batch.errors or [])
        errs.append({"file": key.rsplit("/", 1)[-1], "status": "duplicate", "detail": "identical resume already imported"})
        batch.errors = errs[:MAX_ERRORS]
        db.commit()
        return

    parsed = extract_resume_profile(text, org_id)
    email, real = _email_from(parsed, content_hash)
    cand = db.query(Candidate).filter(Candidate.org_id == org_id, Candidate.email == email).first()
    old_key = None
    if cand is None:
        name = ((parsed.get("basics") or {}).get("full_name") or "").strip() or "Unknown candidate"
        cand = Candidate(
            org_id=org_id, name=name[:100], email=email, role_id=batch.role_id,
            source="bulk", resume_path=key, status="applied",
        )
        db.add(cand)
        db.flush()
    else:
        old_key, cand.resume_path = cand.resume_path, key
        if cand.resume_profile:
            db.delete(cand.resume_profile)
            db.flush()
    from app.services.resume_service import save_profile

    save_profile(db, org_id, cand, text, content_hash, parsed)
    # tag the parse run with this candidate so erasure can scrub its cached result
    from app.models.ai_run import AIRun

    db.query(AIRun).filter(
        AIRun.org_id == org_id, AIRun.cache_key == cache_key_for(text, org_id),
        AIRun.candidate_id.is_(None),
    ).update({"candidate_id": cand.id}, synchronize_session=False)
    db.commit()
    if old_key and old_key != key:
        try:
            storage.delete(old_key)
        except Exception:
            pass
    ranking_service.index_candidate(db, org_id, cand.id)
    if not real:
        errs = list(batch.errors or [])
        errs.append({"file": key.rsplit("/", 1)[-1], "status": "no_email", "detail": "no email found; placeholder address used"})
        batch.errors = errs[:MAX_ERRORS]
        db.commit()


def role_for(db: Session, org_id: int, role_id: int) -> Role | None:
    return db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first()
