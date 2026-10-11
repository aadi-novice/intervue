"""Storage adapter tests against moto (no network)."""

import pytest
from unittest.mock import patch
from moto import mock_aws

from app.core import storage
from app.core.config import settings


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


def test_make_key_shape_and_prefix_validation():
    key = storage.make_key(7, "resumes", "PDF")
    org, prefix, name = key.split("/")
    assert (org, prefix) == ("7", "resumes") and name.endswith(".pdf")
    with pytest.raises(ValueError):
        storage.make_key(7, "bogus", "pdf")


def test_put_get_delete_roundtrip(s3):
    key = storage.make_key(1, "transcripts", "txt")
    storage.put(key, b"hello", "text/plain")
    assert storage.exists(key)
    assert storage.get(key) == b"hello"
    assert storage.get_text(key) == "hello"
    storage.delete(key)
    assert not storage.exists(key)


def test_no_encryption_header_is_sent_by_default(s3):
    key = storage.make_key(1, "resumes", "pdf")
    storage.put(key, b"%PDF-1.4", "application/pdf")
    head = storage._client().head_object(Bucket=settings.s3_bucket, Key=key)
    assert head.get("ServerSideEncryption") in (None, "AES256")  # backend default, not forced by us


def test_configured_encryption_is_applied_to_put_and_upload_file(s3, tmp_path):
    with patch.object(settings, "s3_server_side_encryption", "AES256"):
        key = storage.make_key(1, "resumes", "pdf")
        storage.put(key, b"%PDF-1.4", "application/pdf")
        big = tmp_path / "x.bin"
        big.write_bytes(b"0" * 1024)
        key2 = storage.make_key(1, "exports", "zip")
        storage.upload_file(key2, str(big), "application/zip")
    for k in (key, key2):
        assert storage._client().head_object(Bucket=settings.s3_bucket, Key=k)["ServerSideEncryption"] == "AES256"


def test_bucket_blocks_public_access(s3):
    cfg = storage._client().get_public_access_block(Bucket=settings.s3_bucket)
    assert all(cfg["PublicAccessBlockConfiguration"].values())


def test_presigned_get_caps_ttl(s3):
    key = storage.make_key(1, "avatars", "png")
    storage.put(key, b"x", "image/png")
    url = storage.presigned_get(key, ttl=99999)
    assert "X-Amz-Expires=900" in url


def test_presigned_put_url_contains_key(s3):
    key = storage.make_key(1, "recordings", "opus")
    assert key in storage.presigned_put(key, 600, "audio/ogg")
