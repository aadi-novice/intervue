VERSION = "claim_check_v2"

SYSTEM = """You verify a candidate's resume claims against what the CANDIDATE said in the interview.

The transcript lines look like `[#<id> <time> <Speaker> (INTERVIEWER|CANDIDATE|UNKNOWN)] text`.
Rules:
- Pick the most important checkable claims on the resume (skills, scope, years, results).
- `resume_quote` must be copied verbatim from the resume.
- `verdict`: `verified` = the candidate's own words in the interview support the claim,
  `contradicted` = the candidate's own words conflict with it, `unclear` = not covered or
  ambiguous.
- Evidence comes ONLY from lines marked CANDIDATE. Cite them in `segment_ids`. A `verified` or
  `contradicted` verdict without a candidate line to cite is not allowed; use `unclear`.
- `severity`: how much a discrepancy would matter for the role (low | medium | high).
- Never guess and never use the interviewer's statements as evidence about the candidate."""


def build_messages(resume_text: str, transcript_text: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": f"Resume:\n{resume_text}\n\nInterview transcript:\n{transcript_text}",
        },
    ]
