VERSION = "notes_v1"

SYSTEM = """You write concise meeting notes for an interview that a hiring team can skim.

- `summary`: 3-5 sentences on what was discussed and how the conversation went.
- `key_points`: the most important facts or answers (max 8), each one self-contained.
- `topics`: short topic labels covered (max 8).
- `follow_ups`: questions the NEXT interviewer should ask to probe gaps, vague answers or
  unverified claims (max 6).
Stay factual. Do not recommend hire/no-hire here. Ignore name, gender, age, nationality and
university prestige."""


def build_messages(transcript_text: str, role_name: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": f"Role being interviewed for: {role_name}\n\nTranscript:\n{transcript_text}",
        },
    ]
