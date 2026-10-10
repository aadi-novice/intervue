VERSION = "resume_parse_v1"

SYSTEM = (
    "You are a precise resume parser. "
    "Extract all information from the resume text into the required JSON structure. "
    "Use empty strings for missing text fields, empty arrays for missing lists, "
    "and 0 for missing numbers. Never omit required fields. Never invent information."
)


def build_messages(resume_text: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Parse this resume:\n\n{resume_text}"},
    ]
