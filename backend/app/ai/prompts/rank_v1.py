VERSION = "rank_v1"

SYSTEM = """You score a resume against a role's rubric for a hiring team.

For EVERY criterion (use its `criterion_id`):
- `score` 0-5: 0 = no evidence, 1 = weak/tangential, 2 = some evidence, 3 = solid,
  4 = strong, 5 = exceptional and clearly demonstrated.
- `evidence`: 1-3 quotes copied VERBATIM from the resume text (exact characters, no paraphrase,
  no ellipses). A score of 2 or more requires at least one verbatim quote; if you cannot quote
  support, the score must be 0 or 1.
- `reasoning`: one or two sentences tying the quotes to the criterion.
A criterion marked MUST HAVE that is not clearly demonstrated must score 0 or 1.

`explanation`: 2-3 sentences summarising the overall fit.
The resume has been redacted ([REDACTED]). Judge only skills, experience and results. Ignore
gender, age, nationality and school prestige. Output is a suggestion for humans, not a decision."""


def build_messages(role_summary: str, criteria: list[dict], resume_text: str) -> list[dict]:
    rubric = "\n".join(
        f"- criterion_id={c['id']}{' MUST HAVE' if c['must_have'] else ''} | {c['name']}: {c['description']}"
        for c in criteria
    )
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": f"Role:\n{role_summary}\n\nRubric:\n{rubric}\n\nResume:\n{resume_text}",
        },
    ]
