import re
import json
import os

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)


def _parse_json(content: str):
    """Strip markdown code fences if present, then parse JSON."""
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    return json.loads(content.strip())



def compare_resume_and_transcript(
    resume_text: str,
    transcript_chunks: list
):

    transcript_text = "\n".join([
        chunk["text"]
        for chunk in transcript_chunks
    ])

    prompt = f"""
You are an expert technical interviewer.

Compare the candidate's resume claims
against their actual interview performance.

Resume:
{resume_text}

Transcript:
{transcript_text}

Return ONLY valid JSON in this exact format:
{{
  "comparisons": [
    {{
      "claim": "...",
      "result": "...",
      "severity": "low | medium | high"
    }}
  ]
}}
"""

    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2,
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    return _parse_json(content)