import os
import json

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ── Structured output schema (mirrors the user-defined JSON Schema) ──────────
RESUME_SCHEMA = {
    "type": "object",
    "properties": {
        "basics": {
            "type": "object",
            "properties": {
                "full_name": {"type": "string"},
                "headline":  {"type": "string"},
                "email":     {"type": "string"},
                "phone":     {"type": "string"},
            },
            "required": ["full_name", "headline", "email", "phone"],
        },
        "summary": {"type": "string"},
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "institution":    {"type": "string"},
                    "degree":         {"type": "string"},
                    "field_of_study": {"type": "string"},
                    "start_date":     {"type": "string"},
                    "end_date":       {"type": "string"},
                },
                "required": ["institution", "degree", "field_of_study", "start_date", "end_date"],
            },
        },
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company":      {"type": "string"},
                    "designation":  {"type": "string"},
                    "start_date":   {"type": "string"},
                    "end_date":     {"type": "string"},
                    "is_current":   {"type": "boolean"},
                    "description":  {"type": "string"},
                    "technologies": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "designation", "start_date", "end_date",
                             "is_current", "description", "technologies"],
            },
        },
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name":         {"type": "string"},
                    "description":  {"type": "string"},
                    "technologies": {"type": "array", "items": {"type": "string"}},
                    "github":       {"type": "string"},
                    "live_link":    {"type": "string"},
                },
                "required": ["name", "description", "technologies", "github", "live_link"],
            },
        },
        "skills": {
            "type": "object",
            "properties": {
                "programming_languages": {"type": "array", "items": {"type": "string"}},
                "frameworks":            {"type": "array", "items": {"type": "string"}},
                "databases":             {"type": "array", "items": {"type": "string"}},
                "tools":                 {"type": "array", "items": {"type": "string"}},
            },
            "required": ["programming_languages", "frameworks", "databases", "tools"],
        },
        "metadata": {
            "type": "object",
            "properties": {
                "resume_pages":           {"type": "number"},
                "total_experience_years": {"type": "number"},
            },
            "required": ["resume_pages", "total_experience_years"],
        },
    },
    "required": ["basics", "summary", "education", "experience", "projects", "skills", "metadata"],
}


def extract_resume_profile(resume_text: str) -> dict:
    """
    Calls OpenAI with a JSON-schema constrained response_format so the LLM
    always returns a valid, structured resume profile.  Called at most once
    per candidate (result is cached in the ResumeProfile table).
    """
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a precise resume parser. "
                    "Extract all information from the resume text into the required JSON structure. "
                    "Use empty strings for missing text fields, empty arrays for missing lists, "
                    "and 0 for missing numbers. Never omit required fields."
                ),
            },
            {
                "role": "user",
                "content": f"Parse this resume:\n\n{resume_text}",
            },
        ],
        temperature=0.0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "resume_profile",
                "strict": True,
                "schema": RESUME_SCHEMA,
            },
        },
    )

    content = response.choices[0].message.content
    return json.loads(content)
