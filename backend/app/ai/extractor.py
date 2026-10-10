import io

import fitz

from app.core import storage


def extract_text_from_pdf(key: str) -> str:
    """Extract text from a PDF stored in object storage (`key` is the object key)."""
    document = fitz.open(stream=io.BytesIO(storage.get(key)), filetype="pdf")
    text = "".join(page.get_text() for page in document)
    document.close()
    return text.strip()
