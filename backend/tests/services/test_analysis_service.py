"""Analysis service: segment-cited analysis, evidence enforcement, notes."""

from unittest.mock import patch

import pytest

from app.ai.schemas import (
    ClaimCheckOut,
    ClaimComparison,
    CitedPoint,
    InterviewAnalysisOut,
    InterviewNotesOut,
    KeyMoment,
)
from app.core.errors import Invalid, NotFound
from app.models.interview import InterviewNote
from app.services import analysis_service as svc
from tests.factories import SEGMENTS, make_candidate, make_interview, make_role

P = "app.services.analysis_service"


@pytest.fixture()
def setup(db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, resume_path="k/r.pdf")
    iv = make_interview(db_session, org.id, cand, SEGMENTS)
    seg = {s.text: s.id for s in iv.segments}
    return cand, iv, seg


def _analysis(seg, **over):
    cand_line = seg["I built a compiler in Rust for two years."]
    interviewer_line = seg["Tell me about your Rust experience."]
    base = dict(
        summary="Hire: solid Rust.",
        strengths=[
            CitedPoint(text="Built a compiler", segment_ids=[cand_line]),
            CitedPoint(text="Cites interviewer line only", segment_ids=[interviewer_line]),
            CitedPoint(text="Hallucinated id", segment_ids=[99999]),
            CitedPoint(text="No evidence at all", segment_ids=[]),
        ],
        weaknesses=[CitedPoint(text="Avoided lifetimes", segment_ids=[seg["Mostly arenas, honestly I avoided them."]])],
        key_moments=[
            KeyMoment(moment="Compiler project", signal="positive", segment_id=cand_line),
            KeyMoment(moment="Fake moment", signal="negative", segment_id=424242),
        ],
        technical_score=140,
        communication_score=-5,
        confidence_score=70,
        hiring_recommendation="Hire",
    )
    base.update(over)
    return InterviewAnalysisOut(**base)


def _claims(seg):
    cand_line = seg["I built a compiler in Rust for two years."]
    return ClaimCheckOut(
        comparisons=[
            ClaimComparison(claim="Rust expert", resume_quote="Rust", verdict="verified",
                            explanation="Said so", severity="low", segment_ids=[cand_line]),
            ClaimComparison(claim="Led team of 10", resume_quote="led 10", verdict="contradicted",
                            explanation="No support cited", severity="high", segment_ids=[]),
            ClaimComparison(claim="Uses Go", resume_quote="Go", verdict="verified",
                            explanation="Interviewer said it", severity="low",
                            segment_ids=[seg["Tell me about your Rust experience."]]),
            ClaimComparison(claim="Python", resume_quote="Python", verdict="unclear",
                            explanation="Not covered", severity="low", segment_ids=[]),
        ]
    )


@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_analysis_only_keeps_evidence_backed_points(m_pdf, db_session, org, setup):
    cand, iv, seg = setup
    with patch(f"{P}.generate_interview_analysis", return_value=_analysis(seg)) as gen, patch(
        f"{P}.check_resume_claims", return_value=_claims(seg)
    ):
        a = svc.analyze_interview(db_session, org.id, iv.id)

    # transcript sent to the model carries ids, times, speakers and kinds
    sent = gen.call_args.args[1]
    assert f"[#{seg['I built a compiler in Rust for two years.']} 0:10 Alice (CANDIDATE)]" in sent
    assert gen.call_args.args[2] == org.id

    assert [p["text"] for p in a.strengths] == ["Built a compiler"]  # interviewer/invalid/none dropped
    assert a.strengths[0]["segment_ids"] == [seg["I built a compiler in Rust for two years."]]
    assert [p["text"] for p in a.weaknesses] == ["Avoided lifetimes"]
    assert len(a.key_moments) == 1 and a.key_moments[0]["timestamp_ms"] == 10_000
    assert (a.technical_score, a.communication_score) == (100, 0)  # clamped
    assert (a.interview_id, a.candidate_id, a.org_id, a.role_id) == (iv.id, cand.id, org.id, cand.role_id)
    assert a.prompt_version == "analysis_v2"


@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_claim_verdicts_without_candidate_evidence_are_downgraded(m_pdf, db_session, org, setup):
    cand, iv, seg = setup
    with patch(f"{P}.generate_interview_analysis", return_value=_analysis(seg)), patch(
        f"{P}.check_resume_claims", return_value=_claims(seg)
    ):
        a = svc.analyze_interview(db_session, org.id, iv.id)

    by_claim = {c["claim"]: c for c in a.resume_alignment}
    assert by_claim["Rust expert"]["verdict"] == "verified"
    assert by_claim["Rust expert"]["segment_ids"]
    assert by_claim["Led team of 10"]["verdict"] == "unclear"  # contradicted but nothing cited
    assert by_claim["Uses Go"]["verdict"] == "unclear"  # only the INTERVIEWER's line was cited
    assert by_claim["Uses Go"]["segment_ids"] == []
    assert by_claim["Python"]["verdict"] == "unclear"
    assert by_claim["Rust expert"]["result"] == "Said so"  # legacy field for older clients


@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_unmapped_speakers_block_analysis(m_pdf, db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, resume_path="k/r.pdf")
    iv = make_interview(db_session, org.id, cand, [("Speaker 1", "unknown", "hello"), ("Speaker 2", "unknown", "hi")])
    with pytest.raises(Invalid) as e:
        svc.analyze_interview(db_session, org.id, iv.id)
    assert e.value.code == "speakers_unmapped"


def test_no_resume(db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id)
    iv = make_interview(db_session, org.id, cand, SEGMENTS)
    with pytest.raises(Invalid, match="Resume not uploaded"):
        svc.analyze_interview(db_session, org.id, iv.id)


def test_no_transcript(db_session, org):
    role = make_role(db_session, org.id)
    cand = make_candidate(db_session, org.id, role.id, resume_path="k/r.pdf")
    iv = make_interview(db_session, org.id, cand, [])
    with pytest.raises(Invalid) as e:
        svc.analyze_interview(db_session, org.id, iv.id)
    assert e.value.code == "no_transcript"


def test_other_orgs_interview_not_found(db_session, org, other_org, setup):
    _, iv, _ = setup
    with pytest.raises(NotFound):
        svc.analyze_interview(db_session, other_org.id, iv.id)


NOTES = InterviewNotesOut(
    summary="Discussed Rust.", key_points=["Built a compiler"], topics=["Rust"],
    follow_ups=["Ask about lifetimes in depth"],
)


def test_generate_notes_upserts_single_row(db_session, org, setup):
    _, iv, _ = setup
    with patch(f"{P}.generate_interview_notes", return_value=NOTES) as gen:
        svc.generate_notes(db_session, org.id, iv.id)
        svc.generate_notes(db_session, org.id, iv.id)
    assert db_session.query(InterviewNote).filter_by(interview_id=iv.id).count() == 1
    note = db_session.query(InterviewNote).one()
    assert note.follow_ups == ["Ask about lifetimes in depth"] and note.org_id == org.id
    assert gen.call_args.args[1] == "Engineer"  # role name is passed to the prompt


@patch(f"{P}.extract_text_from_pdf", return_value="Resume text")
def test_notes_failure_does_not_block_analysis(m_pdf, db_session, org, setup):
    _, iv, seg = setup
    with patch(f"{P}.generate_interview_notes", side_effect=RuntimeError("notes down")), patch(
        f"{P}.generate_interview_analysis", return_value=_analysis(seg)
    ), patch(f"{P}.check_resume_claims", return_value=_claims(seg)):
        a = svc.process_interview(db_session, org.id, iv.id)
    assert a is not None and a.interview_id == iv.id
    assert db_session.query(InterviewNote).count() == 0
