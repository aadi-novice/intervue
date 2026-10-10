"""
Assign transcript text to the active speaker observed by the bot (M4.6).

The bot emits `speaker_events` whenever the active speaker changes: `{t_ms, name}` relative to
the recording start. The transcriber returns segments with optional word timings. Whisper
segments can span two speakers, so when word timings exist each word goes to the speaker active
at its midpoint and consecutive words by the same speaker are regrouped; without word timings a
whole segment goes to the speaker with the largest overlap.
"""

import bisect
import re
from dataclasses import dataclass, field

UNKNOWN = "Unknown"
MIN_TURN_MS = 400  # active-speaker indicators flicker; ignore shorter blips
MAX_CHARS = 1500


@dataclass
class Word:
    start_ms: int
    end_ms: int
    word: str


@dataclass
class TSeg:
    start_ms: int
    end_ms: int
    text: str
    words: list[Word] = field(default_factory=list)


@dataclass
class Aligned:
    speaker_label: str
    start_ms: int
    end_ms: int
    text: str


_SUFFIX = re.compile(r"\s*\((you|presenting|host|guest)\)\s*$", re.I)


def clean_name(name: str) -> str:
    name = _SUFFIX.sub("", (name or "").strip())
    return re.sub(r"\s+", " ", name) or UNKNOWN


def build_timeline(events: list[tuple[int, str]], total_ms: int) -> list[tuple[int, int, str]]:
    """Turn change events into [(start, end, name)] covering the call, dropping flicker."""
    evs = sorted((max(0, int(t)), clean_name(n)) for t, n in events)
    spans: list[list] = []
    for i, (t, name) in enumerate(evs):
        end = evs[i + 1][0] if i + 1 < len(evs) else max(total_ms, t)
        if end <= t:
            continue
        if spans and spans[-1][2] == name and spans[-1][1] == t:
            spans[-1][1] = end
        else:
            spans.append([t, end, name])
    # merge blips shorter than MIN_TURN_MS into the previous speaker
    merged: list[list] = []
    for s in spans:
        if merged and s[1] - s[0] < MIN_TURN_MS:
            merged[-1][1] = s[1]
        elif merged and merged[-1][2] == s[2] and merged[-1][1] == s[0]:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [(a, b, n) for a, b, n in merged]


def _speaker_at(timeline, starts, t_ms: int) -> str:
    i = bisect.bisect_right(starts, t_ms) - 1
    if i >= 0 and timeline[i][0] <= t_ms < timeline[i][1]:
        return timeline[i][2]
    return UNKNOWN


def _largest_overlap(timeline, start: int, end: int) -> str:
    best, best_ov = UNKNOWN, 0
    for a, b, n in timeline:
        ov = min(end, b) - max(start, a)
        if ov > best_ov:
            best, best_ov = n, ov
        if a >= end:
            break
    return best


def _join(words: list[Word]) -> str:
    return re.sub(r"\s+", " ", "".join(w.word if w.word.startswith(" ") else " " + w.word for w in words)).strip()


def align(
    segments: list[TSeg], events: list[tuple[int, str]], total_ms: int | None = None
) -> list[Aligned]:
    total = total_ms or (max((s.end_ms for s in segments), default=0))
    timeline = build_timeline(events, total)
    starts = [a for a, _, _ in timeline]
    out: list[Aligned] = []

    def push(label, start, end, text):
        text = text.strip()
        if not text:
            return
        if out and out[-1].speaker_label == label and len(out[-1].text) + len(text) < MAX_CHARS:
            out[-1].text += " " + text
            out[-1].end_ms = max(out[-1].end_ms, end)
        else:
            out.append(Aligned(label, start, end, text))

    for seg in segments:
        if not timeline:
            push(UNKNOWN, seg.start_ms, seg.end_ms, seg.text)
        elif seg.words:
            group: list[Word] = []
            label = None
            for w in seg.words:
                who = _speaker_at(timeline, starts, (w.start_ms + w.end_ms) // 2)
                if label is not None and who != label:
                    push(label, group[0].start_ms, group[-1].end_ms, _join(group))
                    group = []
                label = who
                group.append(w)
            if group:
                push(label, group[0].start_ms, group[-1].end_ms, _join(group))
        else:
            push(_largest_overlap(timeline, seg.start_ms, seg.end_ms), seg.start_ms, seg.end_ms, seg.text)
    return out
