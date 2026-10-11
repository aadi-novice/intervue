"""
S3-compatible object storage adapter (AWS S3, Cloudflare R2, Backblaze B2, MinIO).

The DB stores object *keys* (``{org_id}/{prefix}/{uuid}.{ext}``), never URLs.
Buckets are private; clients get short-lived presigned URLs.
This is the only module that imports boto3.
"""

import uuid
from functools import lru_cache
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import settings

PREFIXES = ("resumes", "transcripts", "avatars", "recordings", "exports")


@lru_cache
def _client():
    return boto3.client(
        "s3",
        region_name=settings.s3_region,
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def reset_client() -> None:
    _client.cache_clear()


def make_key(org_id: int | str, prefix: str, ext: str) -> str:
    if prefix not in PREFIXES:
        raise ValueError(f"Unknown storage prefix: {prefix}")
    ext = "".join(ch for ch in ext.lower() if ch.isalnum())[:10] or "bin"
    return f"{org_id}/{prefix}/{uuid.uuid4()}.{ext}"


def _sse() -> dict:
    return {"ServerSideEncryption": settings.s3_server_side_encryption} if settings.s3_server_side_encryption else {}


def put(key: str, fileobj: BinaryIO | bytes, content_type: str) -> str:
    _client().put_object(
        Bucket=settings.s3_bucket, Key=key, Body=fileobj, ContentType=content_type, **_sse()
    )
    return key


def get(key: str) -> bytes:
    return _client().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def download_file(key: str, path: str) -> None:
    """Stream an object to a local file (large recordings never sit in memory)."""
    _client().download_file(settings.s3_bucket, key, path)


def upload_file(key: str, path: str, content_type: str) -> str:
    """Multipart-capable upload of a local file."""
    _client().upload_file(
        path, settings.s3_bucket, key,
        ExtraArgs={"ContentType": content_type, **_sse()},
    )
    return key


def get_text(key: str, encoding: str = "utf-8") -> str:
    return get(key).decode(encoding)


def exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=settings.s3_bucket, Key=key)
        return True
    except ClientError:
        return False


def delete(key: str) -> None:
    _client().delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_get(key: str, ttl: int | None = None) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=min(ttl or settings.s3_presign_ttl_seconds, 900),
    )


def presigned_get_internal(key: str, ttl: int = 3600) -> str:
    """Longer-lived GET for internal services (transcriber) that may queue before downloading.
    Never hand these to browsers."""
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=min(ttl, 6 * 3600),
    )


def head(key: str) -> dict | None:
    try:
        return _client().head_object(Bucket=settings.s3_bucket, Key=key)
    except ClientError:
        return None


def presigned_put(key: str, ttl: int, content_type: str) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=min(ttl, 3600),
    )


def ensure_bucket() -> None:
    """Create the bucket with Block Public Access + SSE if missing (dev/MinIO/tests)."""
    c = _client()
    try:
        c.head_bucket(Bucket=settings.s3_bucket)
        return
    except ClientError:
        pass
    c.create_bucket(Bucket=settings.s3_bucket)
    try:
        c.put_public_access_block(
            Bucket=settings.s3_bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )
    except ClientError:
        pass  # MinIO has no public access block API; buckets are private by default
