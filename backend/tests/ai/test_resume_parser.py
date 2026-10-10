"""Resume parser goes through the LLM gateway and returns plain dicts."""

from unittest.mock import patch

from app.ai.schemas import ResumeProfileOut


def _profile() -> ResumeProfileOut:
    return ResumeProfileOut.model_validate(
        {
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
            "metadata": {"resume_pages": 1, "total_experience_years": 5},
        }
    )


@patch("app.ai.resume_parser.llm.complete_json")
def test_extract_resume_profile(mock_complete):
    mock_complete.return_value = _profile()

    from app.ai.resume_parser import extract_resume_profile

    result = extract_resume_profile("Resume text here", org_id=7)

    assert result["basics"]["full_name"] == "Alice Smith"
    assert result["skills"]["programming_languages"] == ["Python"]
    kwargs = mock_complete.call_args.kwargs
    assert kwargs["purpose"] == "resume_parse"
    assert kwargs["org_id"] == 7
    assert kwargs["schema"] is ResumeProfileOut
    assert kwargs["prompt_version"] == "resume_parse_v1"
    assert "Resume text here" in kwargs["messages"][1]["content"]
