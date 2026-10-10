"""Small helpers for creating rows directly in tests."""

from app.models.candidate import Candidate
from app.models.role import Role


def make_role(db, org_id: int, name: str = "Engineer", **kw) -> Role:
    role = Role(
        org_id=org_id,
        name=name,
        experience_level=kw.pop("experience_level", "Senior"),
        experience_required_years=kw.pop("experience_required_years", 5),
        **kw,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def make_candidate(
    db, org_id: int, role_id: int, email: str = "alice@example.com", **kw
) -> Candidate:
    cand = Candidate(
        org_id=org_id, name=kw.pop("name", "Alice"), email=email, role_id=role_id, **kw
    )
    db.add(cand)
    db.commit()
    db.refresh(cand)
    return cand


def make_interview(db, org_id: int, candidate, segments=None, title: str = "Round 1", **kw):
    """Interview with candidate + interviewer participants and optional segments.

    segments: list of (speaker_label, speaker_kind, text); start times are 10s apart.
    """
    from app.models.interview import Interview, InterviewParticipant, TranscriptSegment

    iv = Interview(
        org_id=org_id,
        candidate_id=candidate.id,
        role_id=candidate.role_id,
        title=title,
        platform=kw.pop("platform", "upload"),
        **kw,
    )
    db.add(iv)
    db.flush()
    db.add(
        InterviewParticipant(
            interview_id=iv.id, display_name=candidate.name, email=candidate.email, kind="candidate"
        )
    )
    db.add(InterviewParticipant(interview_id=iv.id, display_name="Priya Sharma", kind="interviewer"))
    rows = []
    for i, (label, kind, text) in enumerate(segments or []):
        rows.append(
            TranscriptSegment(
                org_id=org_id, interview_id=iv.id, speaker_label=label, speaker_kind=kind,
                start_ms=i * 10_000, end_ms=i * 10_000 + 9_000, text=text, position=i,
            )
        )
    db.add_all(rows)
    db.commit()
    db.refresh(iv)
    return iv


SEGMENTS = [
    ("Priya Sharma", "interviewer", "Tell me about your Rust experience."),
    ("Alice", "candidate", "I built a compiler in Rust for two years."),
    ("Priya Sharma", "interviewer", "How did you handle lifetimes?"),
    ("Alice", "candidate", "Mostly arenas, honestly I avoided them."),
]
