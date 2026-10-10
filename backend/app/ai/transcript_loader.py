from app.core import storage


def load_transcript(key: str, encoding: str = "utf-8") -> str:
    """Load transcript text from object storage (`key` is the object key)."""
    return storage.get_text(key, encoding=encoding)
