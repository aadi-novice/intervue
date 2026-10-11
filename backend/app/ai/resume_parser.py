from app.ai import llm
from app.ai.prompts import resume_parse_v1 as prompt
from app.ai.schemas import ResumeProfileOut


def cache_key_for(resume_text: str, org_id: int) -> str:
    """The ai_runs cache key of the parse call for this text (used to tag runs with a candidate)."""
    return llm.cache_key(
        org_id, "resume_parse", prompt.VERSION, llm.model_for("resume_parse"),
        prompt.build_messages(resume_text),
    )


def extract_resume_profile(resume_text: str, org_id: int, candidate_id: int | None = None) -> dict:
    """Structured resume extraction (one LLM call per distinct resume text, then cached)."""
    out = llm.complete_json(
        purpose="resume_parse",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(resume_text),
        schema=ResumeProfileOut,
        org_id=org_id,
        temperature=0.0,
        candidate_id=candidate_id,
    )
    return out.model_dump()
