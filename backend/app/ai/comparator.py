from app.ai import llm
from app.ai.prompts import claim_check_v2 as prompt
from app.ai.schemas import ClaimCheckOut


def check_resume_claims(
    resume_text: str, transcript_text: str, org_id: int, candidate_id: int | None = None
) -> ClaimCheckOut:
    return llm.complete_json(
        purpose="claim_check",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(resume_text, transcript_text),
        schema=ClaimCheckOut,
        org_id=org_id,
        temperature=0.2,
        candidate_id=candidate_id,
    )
