import io

import fitz

from app.core.storage import download_bytes


def extract_text_from_pdf(
    blob_url: str,
) -> str:
    """
    Extract text from a PDF stored in Azure Blob Storage.

    `blob_url` is the public HTTPS URL returned when the resume was uploaded.
    """
    pdf_bytes = download_bytes(blob_url)

    document = fitz.open(
        stream=io.BytesIO(pdf_bytes),
        filetype="pdf",
    )

    extracted_text = ""

    for page in document:
        extracted_text += page.get_text()

    document.close()

    return extracted_text.strip()