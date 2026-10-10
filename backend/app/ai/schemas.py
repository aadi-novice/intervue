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
class KeyMoment(BaseModel):
    moment: str
    signal: str


class InterviewAnalysisOut(BaseModel):
    summary: str
    strengths: list[str]
    weaknesses: list[str]
    key_moments: list[KeyMoment]
    technical_score: int
    communication_score: int
    confidence_score: int
    hiring_recommendation: Literal["Strong Hire", "Hire", "Lean No Hire", "No Hire"]


class ClaimComparison(BaseModel):
    claim: str
    result: str
    severity: Literal["low", "medium", "high"]


class ClaimCheckOut(BaseModel):
    comparisons: list[ClaimComparison]
