"""Tests for the transcript loader with mocked Azure Blob Storage."""

from unittest.mock import patch


@patch("app.ai.transcript_loader.storage.get_text")
def test_load_transcript(mock_download):
    """Should download and return the transcript text."""
    mock_download.return_value = "Mocked transcript content"

    from app.ai.transcript_loader import load_transcript

    result = load_transcript("https://storage.example.com/transcript.txt")
    assert result == "Mocked transcript content"
    mock_download.assert_called_once_with(
        "https://storage.example.com/transcript.txt", encoding="utf-8"
    )
