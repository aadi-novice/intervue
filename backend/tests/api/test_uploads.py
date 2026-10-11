"""Uploads: validation, private storage keys, resume parsing via the worker, blob cleanup."""

from unittest.mock import patch

import pytest
from moto import mock_aws

from app.core import storage
from tests.factories import make_candidate, make_role

PDF = b"%PDF-1.4\n%fake but magic-byte valid\n"
PROFILE = {
    "basics": {"full_name": "Alice", "headline": "Eng", "email": "a@x.com", "phone": ""},
    "summary": "s",
    "education": [],
    "experience": [],
    "projects": [],
    "skills": {"programming_languages": ["Python"], "frameworks": [], "databases": [], "tools": []},
    "metadata": {"resume_pages": 1, "total_experience_years": 3},
}


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


@pytest.fixture()
def cand(db_session, org):
    role = make_role(db_session, org.id)
    return make_candidate(db_session, org.id, role.id)


def _up(client, cid, kind, data, name, ctype):
    return client.post(f"/candidates/{cid}/{kind}", files={"file": (name, data, ctype)})


@patch("app.services.resume_service.extract_resume_profile", return_value=PROFILE)
@patch("app.services.resume_service.extract_text_from_pdf", return_value="Alice resume text")
def test_resume_upload_stores_org_prefixed_key_and_parses_in_background(
    m_text, m_parse, s3, client, cand, org
):
    r = _up(client, cand.id, "resume", PDF, "../../evil name.pdf", "application/pdf")

    assert r.status_code == 200
    key = r.json()["file_path"]
    assert key.startswith(f"{org.id}/resumes/") and key.endswith(".pdf")
    assert "evil" not in key  # client filename is never trusted
    assert storage.get(key) == PDF

    detail = client.get(f"/candidates/{cand.id}").json()
    assert detail["resume_parse_status"] == "ready"
    assert detail["resume_profile"]["skills"]["programming_languages"] == ["Python"]
    assert "X-Amz-Signature" in detail["resume_url"]  # short-lived presigned URL, not a public URL
    m_parse.assert_called_once()
    assert m_parse.call_args.args[1] == org.id


@patch("app.services.resume_service.extract_resume_profile", return_value=PROFILE)
@patch("app.services.resume_service.extract_text_from_pdf", return_value="same text")
def test_reparse_is_skipped_when_content_unchanged(m_text, m_parse, s3, client, cand, db_session, org):
    from app.services import resume_service

    _up(client, cand.id, "resume", PDF, "r.pdf", "application/pdf")  # parses once via the worker
    db_session.expire_all()
    resume_service.parse_resume(db_session, org.id, cand.id)
    assert m_parse.call_count == 1  # second call hits the content_hash cache


def test_non_pdf_resume_rejected_by_magic_bytes(s3, client, cand):
    r = _up(client, cand.id, "resume", b"MZ\x90 not a pdf", "r.pdf", "application/pdf")
    assert r.status_code == 415


def test_wrong_content_type_rejected(s3, client, cand):
    assert _up(client, cand.id, "resume", PDF, "r.pdf", "text/html").status_code == 415


def test_oversized_file_rejected(s3, client, cand):
    big = b"%PDF" + b"0" * (10 * 1024 * 1024 + 1)
    assert _up(client, cand.id, "resume", big, "r.pdf", "application/pdf").status_code == 413


def test_empty_file_rejected(s3, client, cand):
    assert _up(client, cand.id, "avatar", b"", "a.png", "image/png").status_code == 422


def test_avatar_extension_comes_from_content_not_filename(s3, client, cand):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    key = _up(client, cand.id, "avatar", png, "photo.exe", "image/png").json()["avatar_path"]
    assert key.endswith(".png")
    detail = client.get(f"/candidates/{cand.id}").json()
    assert "X-Amz-Signature" in detail["avatar_url"]


def test_replacing_a_resume_deletes_the_old_object(s3, client, cand):
    k1 = _up(client, cand.id, "resume", PDF, "a.pdf", "application/pdf").json()["file_path"]
    k2 = _up(client, cand.id, "resume", PDF + b"v2", "b.pdf", "application/pdf").json()["file_path"]
    assert k1 != k2 and not storage.exists(k1) and storage.exists(k2)


def test_deleting_candidate_deletes_all_blobs(s3, client, cand, db_session, org):
    from app.models.interview import Recording
    from tests.factories import make_interview

    client.post(
        f"/candidates/{cand.id}/transcript",
        files={"file": ("t.txt", b"0:01 - Bob\nhi\n", "text/plain")},
    )
    resume = _up(client, cand.id, "resume", PDF, "r.pdf", "application/pdf").json()["file_path"]
    transcript = client.get(f"/candidates/{cand.id}").json()["transcript_path"]
    iv = make_interview(db_session, org.id, cand)
    rec_key = storage.make_key(org.id, "recordings", "opus")
    storage.put(rec_key, b"audio", "audio/ogg")
    db_session.add(
        Recording(org_id=org.id, interview_id=iv.id, blob_path=rec_key, mime_type="audio/ogg")
    )
    db_session.commit()
    assert all(storage.exists(k) for k in (resume, transcript, rec_key))

    assert client.delete(f"/candidates/{cand.id}").status_code == 204

    assert not any(storage.exists(k) for k in (resume, transcript, rec_key))


def test_unreadable_resume_ends_in_a_failed_state_not_an_endless_spinner(s3, client, cand):
    with patch("app.services.resume_service.extract_text_from_pdf", side_effect=RuntimeError("bad pdf lib")):
        r = _up(client, cand.id, "resume", PDF, "r.pdf", "application/pdf")
    assert r.status_code == 200  # the upload itself still succeeds
    d = client.get(f"/candidates/{cand.id}").json()
    assert d["resume_parse_status"] == "failed" and "could not read" in d["resume_parse_error"].lower()
    assert d["resume_url"]  # the file is still downloadable


def test_empty_resume_reports_the_specific_reason(s3, client, cand):
    with patch("app.services.resume_service.extract_text_from_pdf", return_value=""):
        _up(client, cand.id, "resume", PDF, "r.pdf", "application/pdf")
    d = client.get(f"/candidates/{cand.id}").json()
    assert d["resume_parse_status"] == "failed" and "text" in d["resume_parse_error"].lower()


@patch("app.services.resume_service.extract_resume_profile", return_value=PROFILE)
def test_uploading_a_better_file_after_a_failure_recovers(m_parse, s3, client, cand):
    with patch("app.services.resume_service.extract_text_from_pdf", side_effect=RuntimeError("unreadable")):
        _up(client, cand.id, "resume", PDF, "bad.pdf", "application/pdf")
    assert client.get(f"/candidates/{cand.id}").json()["resume_parse_status"] == "failed"
    with patch("app.services.resume_service.extract_text_from_pdf", return_value="Alice resume text"):
        _up(client, cand.id, "resume", PDF + b"v2", "good.pdf", "application/pdf")
    d = client.get(f"/candidates/{cand.id}").json()
    assert d["resume_parse_status"] == "ready" and d["resume_parse_error"] is None


@patch("app.services.resume_service.extract_resume_profile", return_value=PROFILE)
def test_a_transient_failure_that_clears_on_retry_ends_ready(m_parse, s3, client, cand):
    with patch("app.services.resume_service.extract_text_from_pdf", side_effect=[RuntimeError("blip"), "Alice resume text"]):
        _up(client, cand.id, "resume", PDF, "r.pdf", "application/pdf")
    assert client.get(f"/candidates/{cand.id}").json()["resume_parse_status"] == "ready"


def test_healthz_and_readyz(anon_client):
    assert anon_client.get("/healthz").json() == {"status": "ok"}
    r = anon_client.get("/readyz")
    assert r.status_code in (200, 503) and set(r.json()["checks"]) == {"database", "redis", "storage"}
    assert r.json()["checks"]["database"] == "ok"


def test_error_envelope_and_request_id(client):
    r = client.get("/roles/9999")
    assert r.status_code == 404
    assert r.json() == {"detail": "Role not found", "code": "not_found"}
    assert r.headers["x-request-id"]
    v = client.post("/roles/", json={})
    assert v.status_code == 422 and v.json()["code"] == "validation_error"
