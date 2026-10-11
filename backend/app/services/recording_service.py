"""
Post-call pipeline:
  process_recording: concat chunks -> store full recording -> submit transcription
  (transcriber calls back) ->
  finish_transcription: align speakers -> map participants -> notes -> analysis -> notify
"""

import logging
import re
import subprocess
import tempfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.core import email as mailer
from app.core import storage
from app.core.config import settings
from app.core.errors import Invalid, NotFound
from app.models.interview import BotSession, Interview, Recording, SpeakerEvent
from app.models.job import Job
from app.models.tenancy import User
from app.services import analysis_service, job_service, transcript_service, transcription_client
from app.services import speaker_alignment as sa
from app.ai.transcript_formats import ParsedSegment

log = logging.getLogger(__name__)

TRANSCRIPTION = "transcription"
FFMPEG = "ffmpeg"


def _run_ffmpeg_concat(paths: list[Path], out: Path) -> None:
    listing = out.parent / "concat.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in paths))
    proc = subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-c", "copy", str(out)],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {proc.stderr.decode(errors='replace')[:500]}")


def process_recording(db: Session, org_id: int, session_id: int) -> Job | None:
    session = (
        db.query(BotSession)
        .filter(BotSession.id == session_id, BotSession.org_id == org_id)
        .first()
    )
    if session is None:
        raise NotFound("Bot session not found")
    iv = db.get(Interview, session.interview_id)
    chunks = sorted(session.chunks or [], key=lambda c: c["index"])
    if not chunks:
        iv.status = "failed"
        db.commit()
        raise Invalid("The bot uploaded no audio", "no_audio")

    full_key = f"{org_id}/recordings/{session.id}/full.ogg"
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for c in chunks:
            p = Path(tmp) / f"{c['index']:05d}.opus"
            p.write_bytes(storage.get(c["blob"]))
            paths.append(p)
        out = Path(tmp) / "full.ogg"
        _run_ffmpeg_concat(paths, out)
        data = out.read_bytes()
    storage.put(full_key, data, "audio/ogg")

    duration = sum(int(c.get("duration_ms", 0)) for c in chunks) or None
    rec = db.query(Recording).filter(Recording.interview_id == iv.id, Recording.blob_path == full_key).first()
    if rec is None:
        rec = Recording(org_id=org_id, interview_id=iv.id, blob_path=full_key, mime_type="audio/ogg")
        db.add(rec)
    rec.duration_ms, rec.size_bytes = duration, len(data)
    db.commit()
    for c in chunks:  # keep storage tidy; the full recording supersedes the chunks
        try:
            storage.delete(c["blob"])
        except Exception:
            pass
    return submit_transcription(db, org_id, iv.id, full_key)


def submit_transcription(
    db: Session, org_id: int, interview_id: int, audio_key: str, language: str = "auto"
) -> Job:
    job = job_service.create(db, org_id, TRANSCRIPTION, "interview", interview_id)
    try:
        transcription_client.submit(
            f"iv{interview_id}-j{job.id}", storage.presigned_get_internal(audio_key), language
        )
    except Exception as e:
        job_service.set_status(db, job.id, "failed", error=str(e))
        raise
    job_service.set_status(db, job.id, "running")
    iv = db.get(Interview, interview_id)
    iv.status = "processing"
    db.commit()
    return job


def parse_job_id(job_id: str) -> tuple[int, int] | None:
    """'iv12-j34' -> (interview 12, job 34)"""
    m = re.fullmatch(r"iv(\d+)-j(\d+)", job_id or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def store_transcription_result(db: Session, job: Job, body: dict) -> bool:
    """Persist the transcriber callback. Returns True when the pipeline should continue."""
    if job.status in ("completed", "failed"):
        return False  # idempotent: duplicate callbacks are ignored
    iv = db.get(Interview, job.entity_id)
    if body.get("status") != "completed":
        job.status, job.error = "failed", str(body.get("error") or "transcription failed")[:2000]
        if iv:
            iv.status = "failed"
        db.commit()
        return False
    segments = []
    for s in body.get("segments") or []:
        segments.append(
            {
                "start_ms": int(s["start_ms"]),
                "end_ms": int(s["end_ms"]),
                "text": str(s.get("text", "")),
                "words": [
                    [int(w["start_ms"]), int(w["end_ms"]), str(w["word"])]
                    for w in (s.get("words") or [])
                ],
            }
        )
    job.result = {
        "language": body.get("language"),
        "duration_ms": int(body.get("duration_ms") or 0),
        "segments": segments,
    }
    job.status = "running"  # still running: alignment/notes/analysis follow
    db.commit()
    return True


def finish_transcription(db: Session, org_id: int, job_id: int) -> None:
    job = db.query(Job).filter(Job.id == job_id, Job.org_id == org_id).first()
    if job is None or not job.result:
        raise NotFound("Transcription job not found")
    iv = db.get(Interview, job.entity_id)

    tsegs = [
        sa.TSeg(s["start_ms"], s["end_ms"], s["text"], [sa.Word(*w) for w in s["words"]])
        for s in job.result["segments"]
    ]
    events = [
        (e.t_ms, e.speaker_name)
        for e in db.query(SpeakerEvent).filter(SpeakerEvent.interview_id == iv.id)
    ]
    aligned = sa.align(tsegs, events, job.result.get("duration_ms") or None)
    if not aligned:
        job.status, job.error = "failed", "No speech detected in the recording"
        iv.status = "failed"
        db.commit()
        return
    parsed = [ParsedSegment(a.speaker_label, a.start_ms, a.end_ms, a.text) for a in aligned]
    transcript_service.replace_segments(db, iv, parsed)  # also maps names to participants
    iv.status = "completed"
    job.status = "completed"
    db.commit()

    # notes, then analysis if ready (resume present + a speaker mapped to the candidate)
    try:
        analysis_service.generate_notes(db, org_id, iv.id)
    except Exception:
        db.rollback()
        log.exception("notes failed for interview %s", iv.id)
    analysed = _analyse_if_ready(db, org_id, iv.id)
    _notify(db, iv, analysed)


def _analyse_if_ready(db: Session, org_id: int, interview_id: int) -> bool:
    iv = db.get(Interview, interview_id)
    try:
        analysis_service._check_ready(db, org_id, iv)
    except Invalid as e:
        log.info("auto-analysis skipped for interview %s: %s", interview_id, e.code)
        return False
    job = job_service.create(db, org_id, analysis_service.JOB_KIND, "interview", interview_id)
    job_service.set_status(db, job.id, "running")
    try:
        analysis = analysis_service.analyze_interview(db, org_id, interview_id)
    except Exception as e:
        db.rollback()
        job_service.set_status(db, job.id, "failed", error=str(e))
        log.exception("auto-analysis failed for interview %s", interview_id)
        return False
    job_service.set_status(db, job.id, "completed", result={"analysis_id": analysis.id})
    return True


def _notify(db: Session, iv: Interview, analysed: bool) -> None:
    if not iv.created_by_user_id:
        return
    user = db.get(User, iv.created_by_user_id)
    if user is None:
        return
    link = f"{settings.frontend_url}/interviews/{iv.id}"
    extra = "Notes and an analysis are ready." if analysed else (
        "Notes are ready. Map the speakers to run the analysis."
    )
    mailer.send_email(
        user.email, f"Transcript ready: {iv.title}", f"The transcript for {iv.title} is ready. {extra}\n{link}"
    )
    from app.services import notification_service

    notification_service.notify(
        db, iv.org_id, user.id, "transcript_ready", f"Transcript ready: {iv.title}", extra,
        f"/interviews/{iv.id}",
    )


# ── browser -> S3 uploads of audio/video (M3.2) ───────────────────────────────
ALLOWED_UPLOAD_TYPES = {
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "video/mp4": "mp4",
    "video/webm": "webm", "video/quicktime": "mov",
}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
_MAGIC = (
    (0, b"RIFF"),  # wav
    (0, b"ID3"),  # mp3 with tag
    (0, b"OggS"),  # ogg/opus
    (0, b"\x1a\x45\xdf\xa3"),  # webm/matroska (EBML)
    (0, b"\xff\xfb"),  # mp3 frame sync variants
    (0, b"\xff\xf3"),
    (0, b"\xff\xf2"),
    (4, b"ftyp"),  # mp4 / m4a / mov
)


def _looks_like_media(head: bytes) -> bool:
    return any(head[off : off + len(sig)] == sig for off, sig in _MAGIC)


def start_recording_upload(org_id: int, interview_id: int, content_type: str) -> dict:
    ext = ALLOWED_UPLOAD_TYPES.get(content_type)
    if ext is None:
        raise Invalid("Unsupported audio/video type", "unsupported_file")
    import uuid

    key = f"{org_id}/recordings/uploads/{interview_id}/{uuid.uuid4()}.{ext}"
    return {
        "upload_url": storage.presigned_put(key, 3600, content_type),
        "key": key,
        "headers": {"Content-Type": content_type},
        "max_bytes": MAX_UPLOAD_BYTES,
    }


def complete_recording_upload(db: Session, org_id: int, interview_id: int, key: str) -> Recording:
    if not re.fullmatch(rf"{org_id}/recordings/uploads/{interview_id}/[0-9a-f-]{{36}}\.[a-z0-9]{{2,5}}", key or ""):
        raise Invalid("Invalid upload key", "bad_key")
    meta = storage.head(key)
    if meta is None:
        raise Invalid("Upload not found; PUT the file to the upload URL first", "upload_missing")
    size = int(meta.get("ContentLength", 0))
    if size <= 0 or size > MAX_UPLOAD_BYTES:
        storage.delete(key)
        raise Invalid("File is empty or too large", "bad_size")
    head = storage._client().get_object(
        Bucket=settings.s3_bucket, Key=key, Range="bytes=0-31"
    )["Body"].read()
    if not _looks_like_media(head):
        storage.delete(key)
        raise Invalid("File content is not recognised audio/video", "bad_file")
    rec = Recording(
        org_id=org_id, interview_id=interview_id, blob_path=key,
        mime_type=meta.get("ContentType") or "application/octet-stream", size_bytes=size,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec
