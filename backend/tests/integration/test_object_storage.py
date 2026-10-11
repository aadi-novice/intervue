"""
Runs against a real S3-compatible server (MinIO locally, or R2/S3) and is skipped unless
S3_TEST_ENDPOINT_URL is set:

    S3_TEST_ENDPOINT_URL=http://localhost:9000 S3_TEST_ACCESS_KEY=minioadmin S3_TEST_SECRET_KEY=minioadmin \
        uv run pytest tests/integration/test_object_storage.py

moto accepts every header; real servers do not (MinIO without KMS rejects a forced
ServerSideEncryption header). These tests exercise the exact calls the app makes.
"""

import os
import uuid
from unittest.mock import patch

import httpx
import pytest

from app.core import storage
from app.core.config import settings

pytestmark = pytest.mark.integration

ENDPOINT = os.environ.get("S3_TEST_ENDPOINT_URL")


@pytest.fixture(scope="module")
def real_s3():
    if not ENDPOINT:
        pytest.skip("S3_TEST_ENDPOINT_URL not set")
    bucket = f"intervue-it-{uuid.uuid4().hex[:8]}"
    with patch.object(settings, "s3_endpoint_url", ENDPOINT), patch.object(
        settings, "s3_access_key_id", os.environ.get("S3_TEST_ACCESS_KEY", "minioadmin")
    ), patch.object(settings, "s3_secret_access_key", os.environ.get("S3_TEST_SECRET_KEY", "minioadmin")), patch.object(
        settings, "s3_bucket", bucket
    ), patch.object(settings, "s3_server_side_encryption", ""):
        storage.reset_client()
        storage.ensure_bucket()
        yield bucket
        c = storage._client()
        for o in c.list_objects_v2(Bucket=bucket).get("Contents", []):
            c.delete_object(Bucket=bucket, Key=o["Key"])
        c.delete_bucket(Bucket=bucket)
        storage.reset_client()


def test_put_get_exists_delete_with_the_apps_default_settings(real_s3):
    key = storage.make_key(1, "resumes", "pdf")
    storage.put(key, b"%PDF-1.4 hello", "application/pdf")
    assert storage.exists(key) and storage.get(key) == b"%PDF-1.4 hello"
    storage.delete(key)
    assert not storage.exists(key)


def test_upload_and_download_file_used_by_exports(real_s3, tmp_path):
    src = tmp_path / "export.zip"
    src.write_bytes(os.urandom(2 * 1024 * 1024))
    key = storage.make_key(1, "exports", "zip")
    storage.upload_file(key, str(src), "application/zip")
    dst = tmp_path / "back.zip"
    storage.download_file(key, str(dst))
    assert dst.read_bytes() == src.read_bytes()


def test_presigned_urls_work_for_browsers_and_bots(real_s3):
    key = storage.make_key(1, "recordings", "opus")
    put_url = storage.presigned_put(key, 300, "audio/ogg")
    r = httpx.put(put_url, content=b"OggS-audio", headers={"Content-Type": "audio/ogg"})
    assert r.status_code == 200
    got = httpx.get(storage.presigned_get(key, 300))
    assert got.status_code == 200 and got.content == b"OggS-audio"


def test_objects_are_not_publicly_readable(real_s3):
    key = storage.make_key(1, "resumes", "pdf")
    storage.put(key, b"secret", "application/pdf")
    anon = httpx.get(f"{ENDPOINT}/{real_s3}/{key}")  # no signature
    assert anon.status_code in (401, 403)


def test_a_forced_encryption_header_is_the_thing_that_breaks_minio(real_s3):
    """Documents why the default is empty: MinIO without KMS rejects SSE headers."""
    with patch.object(settings, "s3_server_side_encryption", "AES256"):
        try:
            storage.put(storage.make_key(1, "resumes", "pdf"), b"x", "application/pdf")
        except Exception as e:  # noqa: BLE001
            assert "KMS" in str(e) or "encryption" in str(e).lower() or "NotImplemented" in str(e)
        else:
            pytest.skip("this server accepts SSE headers (e.g. AWS S3 / a MinIO with KMS)")
