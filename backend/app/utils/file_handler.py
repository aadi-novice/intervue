from fastapi import UploadFile

from app.core.storage import upload_file as _blob_upload

# Mapping from old local destination paths → blob folder keys
_FOLDER_MAP = {
    "storage/resumes":     "resumes",
    "storage/transcripts": "transcripts",
    "storage/avatars":     "avatars",
}


def save_file(
    file: UploadFile,
    destination: str,
) -> str:
    """
    Upload `file` to Azure Blob Storage.

    `destination` is the legacy local path (e.g. "storage/resumes").
    Returns the public blob URL to be stored in the database.
    """
    folder = _FOLDER_MAP.get(destination, destination.split("/")[-1])
    return _blob_upload(file, folder)