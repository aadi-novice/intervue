import re
import os
import json

from openai import OpenAI
from dotenv import load_dotenv


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


def generate_candidate_analysis(
    resume_text: str,
    transcript_chunks: list
):

    transcript_text = "\n".join([
        chunk["text"]
        for chunk in transcript_chunks
    ])

    prompt = f"""
You are a senior FAANG technical interviewer doing post-interview calibration.
Be brutally honest. Your goal is to help another interviewer remember this candidate 5 days later.

Context:
1. Interview rubric: L3 = 60%, L4 = 75%, L5 = 90%. Most candidates fail.
2. A "good" candidate is 70%+ technical. "Great" is 85%+.

Analyze the candidate based on:

Resume:
{resume_text}

Interview Transcript with timestamps:
{transcript_text}

Return ONLY valid JSON. No prose. Use this exact schema:



  "memory_hook": "One sentence visual + behavioral anchor. Example: 'RAG chatbot guy, blue hoodie, froze on vector DB question but recovered with good system diagram'",
  "summary": "2-3 sentences. Lead with verdict: Strong/Weak hire for [role]. Then why.",
  "strengths": ["Bullet must cite evidence", "Example: 'Explained RAG tradeoffs correctly [23:14]'"],
  "weaknesses": ["Bullet must cite evidence", "Example: 'Could not code BFS without hints [31:02]'"],
  "technical_score": 75,
  "communication_score": 80,
  "confidence_score": 70,
  "key_moments": 
  "hiring_recommendation": "Hire"


"""

    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.3,
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    return _parse_json(content)