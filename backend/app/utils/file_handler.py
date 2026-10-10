from fastapi import HTTPException, UploadFile

from app.core import storage

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_RULES: dict[str, dict] = {
    "resumes": {
        "types": {"application/pdf", DOCX_MIME},
        "magic": (b"%PDF", b"PK\x03\x04"),
        "max_bytes": 10 * 1024 * 1024,
    },
    "avatars": {
        "types": {"image/jpeg", "image/png", "image/webp"},
        "magic": (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF"),
        "max_bytes": 5 * 1024 * 1024,
    },
}

# extension derived from the *content* (never from the client-supplied filename)
_EXT = {
    b"%PDF": "pdf",
    b"PK\x03\x04": "docx",
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"RIFF": "webp",
}


def detect_ext(data: bytes, prefix: str) -> str | None:
    matched = next((m for m in _RULES[prefix]["magic"] if data.startswith(m)), None)
    return _EXT[matched] if matched else None


def save_file(file: UploadFile, prefix: str, org_id: int | str = "default") -> str:
    """Validate (size + magic bytes; filename never trusted) and store; returns the object key."""
    rule = _RULES[prefix]
    file.file.seek(0)
    data = file.file.read(rule["max_bytes"] + 1)
    if len(data) > rule["max_bytes"]:
        raise HTTPException(status_code=413, detail="File too large")
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")
    if file.content_type and file.content_type not in rule["types"]:
        raise HTTPException(status_code=415, detail="Unsupported file type")
    ext = detect_ext(data, prefix)
    if ext is None:
        raise HTTPException(status_code=415, detail="File content does not match its type")
    content_type = file.content_type or "application/octet-stream"
    key = storage.make_key(org_id, prefix, ext)
    return storage.put(key, data, content_type)
