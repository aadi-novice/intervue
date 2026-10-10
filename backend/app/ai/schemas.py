"""Pydantic models used as structured-output schemas for LLM calls.

Strict structured outputs require every field to be present, so no defaults/Optionals here.
"""

from typing import Literal

from pydantic import BaseModel


# ── Resume parsing ────────────────────────────────────────────────────────────
class Basics(BaseModel):
    full_name: str
    headline: str
    email: str
    phone: str


class Education(BaseModel):
    institution: str
    degree: str
    field_of_study: str
    start_date: str
    end_date: str


class Experience(BaseModel):
    company: str
    designation: str
    start_date: str
    end_date: str
    is_current: bool
    description: str
    technologies: list[str]


class Project(BaseModel):
    name: str
    description: str
    technologies: list[str]
    github: str
    live_link: str


class Skills(BaseModel):
    programming_languages: list[str]
    frameworks: list[str]
    databases: list[str]
    tools: list[str]


class ResumeMetadata(BaseModel):
    resume_pages: float
    total_experience_years: float


class ResumeProfileOut(BaseModel):
    basics: Basics
    summary: str
    education: list[Education]
    experience: list[Experience]
    projects: list[Project]
    skills: Skills
    metadata: ResumeMetadata


# ── Interview analysis ────────────────────────────────────────────────────────
class CitedPoint(BaseModel):
    text: str
    segment_ids: list[int]


class KeyMoment(BaseModel):
    moment: str
    signal: Literal["positive", "negative", "neutral"]
    segment_id: int


class InterviewNotesOut(BaseModel):
    summary: str
    key_points: list[str]
    topics: list[str]
    follow_ups: list[str]


class InterviewAnalysisOut(BaseModel):
    summary: str
    strengths: list[CitedPoint]
    weaknesses: list[CitedPoint]
    key_moments: list[KeyMoment]
    technical_score: int
    communication_score: int
    confidence_score: int
    hiring_recommendation: Literal["Strong Hire", "Hire", "Lean No Hire", "No Hire"]


class ClaimComparison(BaseModel):
    claim: str
    resume_quote: str
    verdict: Literal["verified", "unclear", "contradicted"]
    explanation: str
    severity: Literal["low", "medium", "high"]
    segment_ids: list[int]


class ClaimCheckOut(BaseModel):
    comparisons: list[ClaimComparison]


# ── Ranking ───────────────────────────────────────────────────────────────────
class CriterionScoreOut(BaseModel):
    criterion_id: int
    score: int
    evidence: list[str]
    reasoning: str


class RankOut(BaseModel):
    criteria: list[CriterionScoreOut]
    explanation: str


class SuggestedCriterion(BaseModel):
    name: str
    description: str
    weight: float
    must_have: bool


class RubricSuggestOut(BaseModel):
    criteria: list[SuggestedCriterion]
