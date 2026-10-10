VERSION = "rubric_suggest_v1"

SYSTEM = """You turn a job description into a hiring rubric of 4-8 criteria.
Each criterion has a short `name`, a one-sentence `description` of what good evidence looks like in
a resume or interview, a `weight` (all weights roughly sum to 1.0) and `must_have` (true only for
true deal-breakers, at most 2). Cover skills, experience depth and relevant outcomes; do not
include criteria about name, age, gender, nationality or school prestige."""


def build_messages(role_name: str, level: str, years: int, description: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": (
                f"Role: {role_name} ({level}, {years}+ years)\n\nJob description:\n{description}"
            ),
        },
    ]
