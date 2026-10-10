from app.ai import llm
from app.ai.prompts import resume_parse_v1 as prompt
from app.ai.schemas import ResumeProfileOut


def extract_resume_profile(resume_text: str, org_id: int) -> dict:
    """Structured resume extraction (one LLM call per distinct resume text, then cached)."""
    out = llm.complete_json(
        purpose="resume_parse",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(resume_text),
        schema=ResumeProfileOut,
        org_id=org_id,
        temperature=0.0,
    )
    return out.model_dump()
