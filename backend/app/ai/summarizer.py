from app.ai import llm
from app.ai.prompts import analysis_v1 as prompt
from app.ai.schemas import InterviewAnalysisOut


def generate_candidate_analysis(resume_text: str, transcript_text: str, org_id: int) -> dict:
    out = llm.complete_json(
        purpose="analysis",
        prompt_version=prompt.VERSION,
        messages=prompt.build_messages(resume_text, transcript_text),
        schema=InterviewAnalysisOut,
        org_id=org_id,
        temperature=0.3,
    )
    return out.model_dump()
