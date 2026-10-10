"""Post-call pipeline: chunks -> recording -> transcriber -> alignment -> notes -> analysis."""

import json
import time
from unittest.mock import patch

import pytest
from moto import mock_aws

from app.ai.schemas import (
    CitedPoint,
    ClaimCheckOut,
    InterviewAnalysisOut,
    InterviewNotesOut,
    KeyMoment,
)
from app.core import email as mailer
from app.core import security, storage
from app.core.config import settings
from app.models.interview import BotSession, Interview, Recording, SpeakerEvent, TranscriptSegment
from app.models.job import Job
from app.services import recording_service
from tests.factories import make_candidate, make_interview, make_role

MEET = "https://meet.google.com/abc-defg-hij"
A = "app.services.analysis_service"
NOTES = InterviewNotesOut(summary="Discussed Rust.", key_points=["compiler"], topics=["Rust"], follow_ups=["lifetimes"])


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


def fake_concat(paths, out):
    out.write_bytes(b"".join(p.read_bytes() for p in paths))


@pytest.fixture()
def setup(db_session, org, user, s3):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, name="Alex Doe", resume_path=f"{org.id}/resumes/r.pdf")
    iv = make_interview(db_session, org.id, cand, platform="google_meet", meeting_url=MEET,
                        status="processing", created_by_user_id=user.id)
    iv.participants[1].display_name = "Priya Sharma"
    keys = []
    for i in range(2):
        k = f"{org.id}/recordings/1/{i:04d}.opus"
        storage.put(k, f"chunk{i}".encode(), "audio/ogg")
        keys.append(k)
    session = BotSession(
        org_id=org.id, interview_id=iv.id, status="completed",
        chunks=[{"index": i, "blob": k, "start_ms": i * 30000, "duration_ms": 30000} for i, k in enumerate(keys)],
    )
    db_session.add(session)
    db_session.add_all([
        SpeakerEvent(interview_id=iv.id, t_ms=0, speaker_name="Priya Sharma"),
        SpeakerEvent(interview_id=iv.id, t_ms=5000, speaker_name="Alex Doe (You)"),
    ])
    db_session.commit()
    return iv, session, keys


def cb(client, body, secret=None):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    sig = security.sign_body(secret or settings.transcriber_callback_secret, raw, ts)
    return client.post("/internal/transcriber/callback", content=raw, headers={"X-Timestamp": ts, "X-Signature": sig})


CALLBACK = {
    "status": "completed", "language": "en", "duration_ms": 9000,
    "segments": [
        {"start_ms": 0, "end_ms": 4500, "text": "Tell me about Rust.", "words": [
            {"start_ms": 0, "end_ms": 800, "word": " Tell", "probability": 0.9},
            {"start_ms": 800, "end_ms": 4500, "word": " me about Rust.", "probability": 0.9}]},
        {"start_ms": 5200, "end_ms": 9000, "text": "I built a compiler.", "words": []},
    ],
}


class TestProcessRecording:
    def test_concats_chunks_stores_recording_and_submits_job(self, setup, db_session, org):
        iv, session, keys = setup
        with patch("app.services.recording_service._run_ffmpeg_concat", side_effect=fake_concat), patch(
            "app.services.recording_service.transcription_client.submit"
        ) as submit:
            job = recording_service.process_recording(db_session, org.id, session.id)

        assert storage.get(f"{org.id}/recordings/1/full.ogg") == b"chunk0chunk1"
        rec = db_session.query(Recording).filter_by(interview_id=iv.id).one()
        assert (rec.mime_type, rec.duration_ms, rec.size_bytes) == ("audio/ogg", 60000, 12)
        assert not any(storage.exists(k) for k in keys)  # chunks superseded by the full file
        job_id, audio_url, language = submit.call_args.args
        assert job_id == f"iv{iv.id}-j{job.id}" and "X-Amz-Signature" in audio_url and language == "auto"
        assert job.status == "running" and db_session.get(Interview, iv.id).status == "processing"

    def test_no_chunks_fails_interview(self, db_session, org, setup):
        iv, session, _ = setup
        session.chunks = []
        db_session.commit()
        from app.core.errors import Invalid

        with pytest.raises(Invalid):
            recording_service.process_recording(db_session, org.id, session.id)
        db_session.refresh(iv)
        assert iv.status == "failed"

    def test_transcriber_down_marks_job_failed_and_raises(self, setup, db_session, org):
        iv, session, _ = setup
        with patch("app.services.recording_service._run_ffmpeg_concat", side_effect=fake_concat), patch(
            "app.services.recording_service.transcription_client.submit", side_effect=RuntimeError("503")
        ):
            with pytest.raises(RuntimeError):
                recording_service.process_recording(db_session, org.id, session.id)
        assert db_session.query(Job).filter_by(kind="transcription").one().status == "failed"


class TestTranscriberCallback:
    @pytest.fixture()
    def running(self, setup, db_session, org):
        iv, session, _ = setup
        with patch("app.services.recording_service._run_ffmpeg_concat", side_effect=fake_concat), patch(
            "app.services.recording_service.transcription_client.submit"
        ):
            job = recording_service.process_recording(db_session, org.id, session.id)
        return iv, job

    def test_signature_required(self, anon_client, running):
        iv, job = running
        body = {**CALLBACK, "job_id": f"iv{iv.id}-j{job.id}"}
        assert anon_client.post("/internal/transcriber/callback", json=body).status_code == 401
        assert cb(anon_client, body, secret="wrong").status_code == 401

    def test_unknown_or_mismatched_job(self, anon_client, running):
        iv, job = running
        assert cb(anon_client, {**CALLBACK, "job_id": "iv1-j9999"}).status_code == 404
        assert cb(anon_client, {**CALLBACK, "job_id": f"iv{iv.id + 50}-j{job.id}"}).status_code == 404
        assert cb(anon_client, {"job_id": "garbage"}).status_code == 422

    def test_full_pipeline_aligns_speakers_maps_participants_and_analyses(
        self, anon_client, running, db_session, org
    ):
        iv, job = running
        db_session.query(TranscriptSegment).filter_by(interview_id=iv.id).delete()  # no stale rows
        db_session.commit()
        cand_ids = {}

        def analysis(resume, transcript, org_id):
            ids = [s.id for s in db_session.query(TranscriptSegment).filter_by(interview_id=iv.id, speaker_kind="candidate")]
            cand_ids["ids"] = ids
            return InterviewAnalysisOut(
                summary="Hire.", strengths=[CitedPoint(text="Built a compiler", segment_ids=ids)],
                weaknesses=[], key_moments=[KeyMoment(moment="compiler", signal="positive", segment_id=ids[0])],
                technical_score=80, communication_score=80, confidence_score=80, hiring_recommendation="Hire",
            )

        with patch(f"{A}.generate_interview_notes", return_value=NOTES), patch(
            f"{A}.generate_interview_analysis", side_effect=analysis
        ), patch(f"{A}.check_resume_claims", return_value=ClaimCheckOut(comparisons=[])), patch(
            f"{A}.extract_text_from_pdf", return_value="resume"
        ):
            r = cb(anon_client, {**CALLBACK, "job_id": f"iv{iv.id}-j{job.id}"})
        assert r.status_code == 200

        db_session.expire_all()
        segs = db_session.query(TranscriptSegment).filter_by(interview_id=iv.id).order_by(TranscriptSegment.position).all()
        assert [(s.speaker_label, s.speaker_kind, s.text) for s in segs] == [
            ("Priya Sharma", "interviewer", "Tell me about Rust."),
            ("Alex Doe", "candidate", "I built a compiler."),
        ]
        assert db_session.get(Interview, iv.id).status == "completed"
        assert db_session.get(Job, job.id).status == "completed"
        assert iv.notes.summary == "Discussed Rust."
        analysis_job = db_session.query(Job).filter_by(kind="analysis", entity_id=iv.id).one()
        assert analysis_job.status == "completed" and analysis_job.result["analysis_id"]
        mail = [m for m in mailer.outbox if "Transcript ready" in m["subject"]]
        assert mail and "Notes and an analysis are ready" in mail[0]["text"]

    def test_unmapped_speakers_still_deliver_transcript_and_notes_but_skip_analysis(
        self, anon_client, running, db_session, org
    ):
        iv, job = running
        db_session.query(SpeakerEvent).filter_by(interview_id=iv.id).delete()  # bot saw nobody speak
        db_session.commit()
        with patch(f"{A}.generate_interview_notes", return_value=NOTES) as notes, patch(
            f"{A}.generate_interview_analysis"
        ) as gen:
            cb(anon_client, {**CALLBACK, "job_id": f"iv{iv.id}-j{job.id}"})
        gen.assert_not_called()
        notes.assert_called_once()
        db_session.expire_all()
        segs = db_session.query(TranscriptSegment).filter_by(interview_id=iv.id).all()
        assert {s.speaker_label for s in segs} == {"Unknown"} and all(s.speaker_kind == "unknown" for s in segs)
        assert db_session.get(Interview, iv.id).status == "completed"
        assert db_session.query(Job).filter_by(kind="analysis").count() == 0
        assert "Map the speakers" in [m for m in mailer.outbox if "Transcript ready" in m["subject"]][0]["text"]

    def test_duplicate_callbacks_are_ignored(self, anon_client, running, db_session):
        iv, job = running
        body = {**CALLBACK, "job_id": f"iv{iv.id}-j{job.id}"}
        with patch(f"{A}.generate_interview_notes", return_value=NOTES) as notes:
            cb(anon_client, body)
            cb(anon_client, body)
        assert notes.call_count == 1

    def test_failed_transcription_fails_interview(self, anon_client, running, db_session):
        iv, job = running
        cb(anon_client, {"job_id": f"iv{iv.id}-j{job.id}", "status": "failed", "error": "model OOM"})
        db_session.expire_all()
        assert db_session.get(Job, job.id).status == "failed" and "OOM" in db_session.get(Job, job.id).error
        assert db_session.get(Interview, iv.id).status == "failed"

    def test_silence_fails_with_clear_error(self, anon_client, running, db_session):
        iv, job = running
        cb(anon_client, {"job_id": f"iv{iv.id}-j{job.id}", "status": "completed", "duration_ms": 1000, "segments": []})
        db_session.expire_all()
        j = db_session.get(Job, job.id)
        assert j.status == "failed" and "No speech" in j.error
        assert db_session.get(Interview, iv.id).status == "failed"


class TestAudioUpload:
    @pytest.fixture()
    def iv(self, db_session, org, s3):
        cand = make_candidate(db_session, org.id, make_role(db_session, org.id).id)
        return make_interview(db_session, org.id, cand)

    def test_presigned_flow_registers_recording_and_enqueues_transcription(self, client, iv, org, db_session):
        r = client.post(f"/interviews/{iv.id}/recording-upload", json={"content_type": "audio/mpeg"})
        assert r.status_code == 200
        key = r.json()["key"]
        assert key.startswith(f"{org.id}/recordings/uploads/{iv.id}/") and key.endswith(".mp3")
        assert "X-Amz-Signature" in r.json()["upload_url"]
        storage.put(key, b"ID3\x04\x00 fake mp3", "audio/mpeg")  # what the browser PUT would do

        with patch("app.worker.tasks.bots.transcribe_upload_task.delay") as delay:
            done = client.post(f"/interviews/{iv.id}/recording-upload/complete", json={"key": key})
        assert done.status_code == 202
        delay.assert_called_once_with(org.id, iv.id, key)
        assert db_session.query(Recording).filter_by(interview_id=iv.id, blob_path=key).count() == 1

    def test_unsupported_type(self, client, iv):
        r = client.post(f"/interviews/{iv.id}/recording-upload", json={"content_type": "application/x-msdownload"})
        assert r.status_code == 422 and r.json()["code"] == "unsupported_file"

    def test_non_media_content_is_rejected_and_deleted(self, client, iv, org):
        key = client.post(f"/interviews/{iv.id}/recording-upload", json={"content_type": "audio/wav"}).json()["key"]
        storage.put(key, b"MZ this is an exe", "audio/wav")
        r = client.post(f"/interviews/{iv.id}/recording-upload/complete", json={"key": key})
        assert r.status_code == 422 and r.json()["code"] == "bad_file"
        assert not storage.exists(key)

    def test_missing_object_and_forged_keys(self, client, iv, org):
        key = client.post(f"/interviews/{iv.id}/recording-upload", json={"content_type": "audio/wav"}).json()["key"]
        assert client.post(f"/interviews/{iv.id}/recording-upload/complete", json={"key": key}).json()["code"] == "upload_missing"
        for bad in (f"{org.id + 1}/recordings/uploads/{iv.id}/{'a' * 36}.wav", f"{org.id}/resumes/x.pdf", "../x"):
            assert client.post(f"/interviews/{iv.id}/recording-upload/complete", json={"key": bad}).json()["code"] == "bad_key"

    def test_other_orgs_interview_404(self, other_client, iv):
        assert other_client.post(f"/interviews/{iv.id}/recording-upload", json={"content_type": "audio/wav"}).status_code == 404
