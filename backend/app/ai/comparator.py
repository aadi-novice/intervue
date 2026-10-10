from app.ai import llm
from app.ai.prompts import claim_check_v1 as prompt
from app.ai.schemas import ClaimCheckOut


def compare_resume_and_transcript(resume_text: str, transcript_text: str, org_id: int) -> dict:
    out = llm.complete_json(
        purpose="claim_check",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(resume_text, transcript_text),
        schema=ClaimCheckOut,
        org_id=org_id,
        temperature=0.2,
    )
    return out.model_dump()
