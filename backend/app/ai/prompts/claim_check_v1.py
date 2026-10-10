VERSION = "claim_check_v1"

SYSTEM = """You compare a candidate's resume claims against what they actually said in the interview.
For each notable claim, say whether the interview confirmed, contradicted or did not cover it
in `result`, and rate how much a discrepancy matters in `severity` (low | medium | high).
Only use the candidate's own statements in the transcript as evidence. Do not guess."""


def build_messages(resume_text: str, transcript_text: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": f"Resume:\n{resume_text}\n\nTranscript:\n{transcript_text}",
        },
    ]
