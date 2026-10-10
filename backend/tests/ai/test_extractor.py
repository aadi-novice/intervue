"""Tests for the PDF text extractor with mocked Azure Blob Storage."""

from unittest.mock import patch


@patch("app.ai.extractor.storage.get")
def test_extract_text_from_pdf(mock_download):
    """Should download PDF bytes and extract text."""
    # A minimal valid PDF with text "Hello World"
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R"
        b"/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n"
        b"4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"5 0 obj<</Length 44>>stream\n"
        b"BT /F1 12 Tf 100 700 Td (Hello World) Tj ET\nendstream\nendobj\n"
        b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n"
        b"0000000115 00000 n \n0000000266 00000 n \n0000000344 00000 n \n"
        b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n446\n%%EOF"
    )
    mock_download.return_value = minimal_pdf

    from app.ai.extractor import extract_text_from_pdf

    result = extract_text_from_pdf("https://storage.example.com/resume.pdf")
    assert "Hello World" in result
    mock_download.assert_called_once_with("https://storage.example.com/resume.pdf")
