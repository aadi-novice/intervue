from app.core.storage import download_text


def load_transcript(
    blob_url: str,
    encoding: str = "utf-8",
) -> str:
    """
    Load transcript text from Azure Blob Storage.

    `blob_url` is the public HTTPS URL returned when the transcript was uploaded.
    """
    return download_text(blob_url, encoding=encoding)