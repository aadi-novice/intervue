import pytest

from app.core.redact import scrub


@pytest.mark.parametrize("raw,leaked", [
    ("Incorrect API key provided: sk-proj-abcdefghijklmnop1234", "abcdefghijklmnop"),
    ("auth failed for Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig", "eyJhbGciOiJSUzI1NiJ9"),
    ("connect failed password=hunter2hunter2 host=db", "hunter2hunter2"),
    ("key AKIAABCDEFGHIJKLMNOP denied", "AKIAABCDEFGHIJKLMNOP"),
])
def test_secrets_are_removed(raw, leaked):
    out = scrub(raw)
    assert leaked not in out and "redacted" in out


def test_plain_text_untouched_and_truncated():
    assert scrub("Resume not uploaded") == "Resume not uploaded"
    assert len(scrub("x" * 5000)) == 2000
    assert scrub(None) is None
