from fastapi import HTTPException, UploadFile

from app.core import storage

_RULES: dict[str, dict] = {
    "resumes": {
        "types": {"application/pdf"},
        "magic": (b"%PDF",),
        "max_bytes": 10 * 1024 * 1024,
        "ext": "pdf",
    },
    "avatars": {
        "types": {"image/jpeg", "image/png", "image/webp"},
        "magic": (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF"),
        "max_bytes": 5 * 1024 * 1024,
        "ext": None,
    },
}

_IMAGE_EXT = {b"\xff\xd8\xff": "jpg", b"\x89PNG\r\n\x1a\n": "png", b"RIFF": "webp"}


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

    ext = rule["ext"]
    if rule["magic"]:
        matched = next((m for m in rule["magic"] if data.startswith(m)), None)
        if matched is None:
            raise HTTPException(status_code=415, detail="File content does not match its type")
        ext = ext or _IMAGE_EXT[matched]
    content_type = file.content_type or "application/octet-stream"
    key = storage.make_key(org_id, prefix, ext)
    return storage.put(key, data, content_type)
