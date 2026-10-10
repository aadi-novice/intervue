import io

import fitz

from app.core import storage


def pdf_bytes_to_text(data: bytes) -> str:
    document = fitz.open(stream=io.BytesIO(data), filetype="pdf")
    try:
        return "".join(page.get_text() for page in document).strip()
    finally:
        document.close()


def docx_bytes_to_text(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))
    return "\n".join(p for p in parts if p.strip()).strip()


def extract_text_from_bytes(data: bytes, filename: str = "") -> str:
    """PDF or DOCX bytes -> text (by magic bytes first, then extension)."""
    if data.startswith(b"%PDF") or filename.lower().endswith(".pdf"):
        return pdf_bytes_to_text(data)
    if data.startswith(b"PK") or filename.lower().endswith(".docx"):
        return docx_bytes_to_text(data)
    raise ValueError("Unsupported resume format (PDF or DOCX required)")


def extract_text_from_pdf(key: str) -> str:
    """Extract text from a resume stored in object storage (`key` is the object key).

    Name kept for compatibility; DOCX resumes are handled too.
    """
    return extract_text_from_bytes(storage.get(key), key)
