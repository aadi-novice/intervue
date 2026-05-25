"""
Azure Blob Storage service.

All file I/O (resumes, transcripts, avatars) goes through this module
instead of the local filesystem.
"""

import os
import uuid

from azure.storage.blob import BlobServiceClient, ContentSettings
from fastapi import UploadFile

# ── Configuration ──────────────────────────────────────────────────────────────

_CONNECTION_STRING = os.getenv("AZURE_STORAGE_CONNECTION_STRING")

# Container names (will be auto-created if missing)
CONTAINERS = {
    "resumes":     "resumes",
    "transcripts": "transcripts",
    "avatars":     "avatars",
}

# Content-type hints per container
_CONTENT_TYPES: dict[str, str] = {
    "resumes":     "application/pdf",
    "transcripts": "text/plain",
    "avatars":     "image/jpeg",
}


def _get_client() -> BlobServiceClient:
    if not _CONNECTION_STRING:
        raise RuntimeError(
            "AZURE_STORAGE_CONNECTION_STRING is not set in environment variables."
        )
    return BlobServiceClient.from_connection_string(_CONNECTION_STRING)


def _ensure_container(client: BlobServiceClient, container_name: str) -> None:
    """Create the container if it doesn't exist (with public blob access)."""
    container_client = client.get_container_client(container_name)
    try:
        container_client.create_container(public_access="blob")
    except Exception:
        # Container already exists — ignore
        pass


# ── Public API ─────────────────────────────────────────────────────────────────

def upload_file(file: UploadFile, folder: str) -> str:
    """
    Upload an UploadFile to the Azure Blob container that matches `folder`
    (one of 'resumes', 'transcripts', 'avatars').

    Returns the public blob URL which is stored in the database.
    """
    container_name = CONTAINERS.get(folder, folder)

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin"
    blob_name = f"{uuid.uuid4()}.{ext}"

    content_type = _CONTENT_TYPES.get(container_name, "application/octet-stream")

    client = _get_client()
    _ensure_container(client, container_name)

    blob_client = client.get_blob_client(
        container=container_name,
        blob=blob_name,
    )

    file.file.seek(0)
    blob_client.upload_blob(
        file.file.read(),
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )

    return blob_client.url  # public HTTPS URL


def download_bytes(blob_url: str) -> bytes:
    """
    Download the content of a blob by its full URL.
    Works for any of the three containers.
    """
    client = _get_client()
    blob_client = client.get_blob_client_from_url(blob_url)
    stream = blob_client.download_blob()
    return stream.readall()


def download_text(blob_url: str, encoding: str = "utf-8") -> str:
    """Download a text blob (e.g. transcript) and decode it."""
    return download_bytes(blob_url).decode(encoding)
