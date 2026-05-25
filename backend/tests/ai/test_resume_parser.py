"""Tests for the resume parser with mocked OpenAI calls."""

import json
from unittest.mock import patch


def _mock_openai_response(content: str):
    """Create a mock OpenAI chat completion response."""
    class MockMessage:
        def __init__(self, content):
            self.content = content

    class MockChoice:
        def __init__(self, content):
            self.message = MockMessage(content)

    class MockResponse:
        def __init__(self, content):
            self.choices = [MockChoice(content)]

    return MockResponse(content)


@patch("app.ai.resume_parser.client.chat.completions.create")
def test_extract_resume_profile(mock_create):
    """Should call OpenAI and parse the returned JSON."""
    mock_data = {
        "basics": {
            "full_name": "Alice Smith",
            "headline": "Software Engineer",
            "email": "alice@example.com",
            "phone": "+1-555-0100",
        },
        "summary": "Experienced engineer",
        "education": [
            {
                "institution": "MIT",
                "degree": "BS",
                "field_of_study": "CS",
                "start_date": "2015",
                "end_date": "2019",
            }
        ],
        "experience": [],
        "projects": [],
        "skills": {
            "programming_languages": ["Python"],
            "frameworks": ["Django"],
            "databases": ["Postgres"],
            "tools": ["Git"],
        },
        "metadata": {
            "resume_pages": 1,
            "total_experience_years": 5,
        },
    }
    mock_create.return_value = _mock_openai_response(json.dumps(mock_data))

    from app.ai.resume_parser import extract_resume_profile

    result = extract_resume_profile("Resume text here")
    assert result["basics"]["full_name"] == "Alice Smith"
    assert result["skills"]["programming_languages"] == ["Python"]
    assert result["metadata"]["resume_pages"] == 1
    mock_create.assert_called_once()
