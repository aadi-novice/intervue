"""Transcript segments: creation from parsed files, listing, speaker mapping."""

import re
from collections import OrderedDict

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.transcript_formats import ParsedSegment, format_ms
from app.api.deps import OrgContext
from app.core.errors import Invalid
from app.models.interview import Interview, InterviewParticipant, TranscriptSegment
from app.schemas.interview import SpeakerMapping, SpeakerSummary


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", name.lower()).strip()


def _name_matches(label: str, participant_name: str) -> bool:
    a, b = _norm(label), _norm(participant_name)
    if not a or not b:
        return False
    if a == b:
        return True
    ta, tb = set(a.split()), set(b.split())
    # "Priya" matches "Priya Sharma"; "Priya S" too. Single common first name is enough only
    # when the shorter label is fully contained in the longer name.
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


def _kind_for(label: str, hint: str, participants: list[InterviewParticipant]):
    """Auto-map a speaker label to a participant. Returns (participant|None, kind)."""
    matches = [p for p in participants if _name_matches(label, p.display_name)]
    # prefer an exact full-name match
    exact = [p for p in matches if _norm(p.display_name) == _norm(label)]
    if exact:
        chosen = exact[0]
    elif len(matches) == 1:
        chosen = matches[0]
    else:
        chosen = None  # no match, or ambiguous ("Alex" vs "Alex Kumar" / "Alex Doe")
    if chosen is not None and chosen.kind in ("interviewer", "candidate"):
        return chosen, chosen.kind
    if hint in ("interviewer", "candidate"):
        return chosen, hint
    return chosen, "unknown"


def replace_segments(
    db: Session, interview: Interview, parsed: list[ParsedSegment]
) -> list[TranscriptSegment]:
    """Replace the interview's segments with `parsed`, auto-mapping speakers."""
    db.query(TranscriptSegment).filter(TranscriptSegment.interview_id == interview.id).delete()
    db.flush()
    participants = list(interview.participants)
    cache: dict[str, tuple] = {}
    rows = []
    for i, p in enumerate(parsed):
        if p.speaker_label not in cache:
            cache[p.speaker_label] = _kind_for(p.speaker_label, p.kind_hint, participants)
        part, kind = cache[p.speaker_label]
        rows.append(
            TranscriptSegment(
                org_id=interview.org_id,
                interview_id=interview.id,
                speaker_label=p.speaker_label,
                participant_id=part.id if part else None,
                speaker_kind=kind,
                start_ms=p.start_ms,
                end_ms=p.end_ms,
                text=p.text,
                position=i,
            )
        )
    db.add_all(rows)
    db.flush()
    return rows


def list_segments(
    db: Session, interview_id: int, org_id: int, offset: int, limit: int
) -> tuple[list[TranscriptSegment], int]:
    q = db.query(TranscriptSegment).filter(
        TranscriptSegment.interview_id == interview_id, TranscriptSegment.org_id == org_id
    )
    total = q.count()
    items = q.order_by(TranscriptSegment.position).offset(offset).limit(limit).all()
    return items, total


def speaker_summaries(db: Session, interview_id: int, org_id: int) -> list[SpeakerSummary]:
    rows = (
        db.query(
            TranscriptSegment.speaker_label,
            TranscriptSegment.speaker_kind,
            TranscriptSegment.participant_id,
            func.count(TranscriptSegment.id),
            func.min(TranscriptSegment.position),
        )
        .filter(TranscriptSegment.interview_id == interview_id, TranscriptSegment.org_id == org_id)
        .group_by(
            TranscriptSegment.speaker_label,
            TranscriptSegment.speaker_kind,
            TranscriptSegment.participant_id,
        )
        .order_by(func.min(TranscriptSegment.position))
        .all()
    )
    return [
        SpeakerSummary(
            speaker_label=label, speaker_kind=kind, participant_id=pid, segment_count=count
        )
        for label, kind, pid, count, _ in rows
    ]


def map_speakers(
    db: Session, ctx: OrgContext, interview: Interview, mappings: list[SpeakerMapping]
) -> None:
    by_id = {p.id: p for p in interview.participants}
    labels = {
        r[0]
        for r in db.query(TranscriptSegment.speaker_label)
        .filter(TranscriptSegment.interview_id == interview.id)
        .distinct()
    }
    for m in mappings:
        if m.speaker_label not in labels:
            raise Invalid(f"Unknown speaker label: {m.speaker_label}", "unknown_speaker")
        part = None
        if m.participant_id is not None:
            part = by_id.get(m.participant_id)
            if part is None:
                raise Invalid("Participant does not belong to this interview", "bad_participant")
        kind = m.kind
        if kind is None:
            if part is None:
                kind = "unknown"
            else:
                kind = part.kind if part.kind in ("interviewer", "candidate") else "unknown"
        db.query(TranscriptSegment).filter(
            TranscriptSegment.interview_id == interview.id,
            TranscriptSegment.speaker_label == m.speaker_label,
        ).update(
            {"participant_id": part.id if part else None, "speaker_kind": kind},
            synchronize_session=False,
        )
    db.commit()


def format_for_llm(segments: list[TranscriptSegment]) -> str:
    """`[#12 3:14 Alex Doe (CANDIDATE)] text` — ids let the model cite its evidence."""
    return "\n".join(
        f"[#{s.id} {format_ms(s.start_ms)} {s.speaker_label} ({s.speaker_kind.upper()})] {s.text}"
        for s in segments
    )


def distinct_labels(segments: list[TranscriptSegment]) -> list[str]:
    return list(OrderedDict.fromkeys(s.speaker_label for s in segments))
