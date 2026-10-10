from app.ai import llm
from app.ai.prompts import analysis_v2, notes_v1
from app.ai.schemas import InterviewAnalysisOut, InterviewNotesOut


def generate_interview_analysis(
    resume_text: str, transcript_text: str, org_id: int
) -> InterviewAnalysisOut:
    return llm.complete_json(
        purpose="analysis",
        prompt_version=analysis_v2.VERSION,
        messages=analysis_v2.build_messages(resume_text, transcript_text),
        schema=InterviewAnalysisOut,
        org_id=org_id,
        temperature=0.3,
    )


def generate_interview_notes(
    transcript_text: str, role_name: str, org_id: int
) -> InterviewNotesOut:
    return llm.complete_json(
        purpose="interview_notes",
        prompt_version=notes_v1.VERSION,
        messages=notes_v1.build_messages(transcript_text, role_name),
        schema=InterviewNotesOut,
        org_id=org_id,
        temperature=0.2,
    )
