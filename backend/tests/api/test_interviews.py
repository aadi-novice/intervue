"""Interviews API: scheduling, transcript upload, speaker mapping, visibility, recordings."""

import pytest
from moto import mock_aws

from app.core import storage
from app.models.interview import Recording
from app.models.tenancy import AuditLog
from tests.factories import SEGMENTS, make_candidate, make_interview, make_role

TXT = (
    "0:00 - Priya Sharma (Interviewer)\nTell me about Rust.\n"
    "0:20 - Alice\nI built a compiler.\n"
    "0:45 - Unknown Person\nSorry I am late.\n"
)


@pytest.fixture()
def s3():
    with mock_aws():
        storage.reset_client()
        storage.ensure_bucket()
        yield
    storage.reset_client()


@pytest.fixture()
def cand(db_session, org):
    return make_candidate(db_session, org.id, make_role(db_session, org.id).id)


def _create(client, cand, **over):
    body = {"candidate_id": cand.id, "title": "Technical round", **over}
    return client.post("/interviews", json=body)


class TestCreateAndList:
    def test_create_adds_candidate_participant_and_detects_platform(self, client, cand):
        r = _create(client, cand, meeting_url="https://meet.google.com/abc-defg-hij",
                    participants=[{"display_name": "Priya Sharma", "kind": "interviewer"}])
        assert r.status_code == 201
        d = r.json()
        assert d["platform"] == "google_meet" and d["status"] == "scheduled"
        assert {(p["display_name"], p["kind"]) for p in d["participants"]} == {
            (cand.name, "candidate"), ("Priya Sharma", "interviewer"),
        }
        assert d["candidate_name"] == cand.name and d["role_name"] == "Engineer"

    @pytest.mark.parametrize("url,platform", [
        ("https://teams.microsoft.com/l/meetup-join/xyz", "teams"),
        ("https://acme.zoom.us/j/123456", "zoom"),
    ])
    def test_platform_detection(self, client, cand, url, platform):
        assert _create(client, cand, meeting_url=url).json()["platform"] == platform

    def test_unsupported_meeting_url(self, client, cand):
        r = _create(client, cand, meeting_url="https://example.com/call")
        assert r.status_code == 422 and r.json()["code"] == "bad_meeting_url"

    def test_no_url_means_upload_interview(self, client, cand):
        assert _create(client, cand).json()["platform"] == "upload"

    def test_end_before_start_rejected(self, client, cand):
        r = _create(client, cand, scheduled_start="2026-10-10T10:00:00Z", scheduled_end="2026-10-10T09:00:00Z")
        assert r.status_code == 422 and r.json()["code"] == "bad_schedule"

    def test_unknown_or_foreign_candidate_404(self, client, other_client, cand):
        assert client.post("/interviews", json={"candidate_id": 999, "title": "x"}).status_code == 404
        assert other_client.post("/interviews", json={"candidate_id": cand.id, "title": "x"}).status_code == 404

    def test_list_filters(self, client, db_session, org, cand):
        other = make_candidate(db_session, org.id, cand.role_id, "bob@example.com", name="Bob")
        _create(client, cand, scheduled_start="2026-10-01T10:00:00Z")
        _create(client, other, scheduled_start="2026-11-01T10:00:00Z")
        assert len(client.get("/interviews").json()) == 2
        assert [i["candidate_name"] for i in client.get(f"/interviews?candidate_id={other.id}").json()] == ["Bob"]
        r = client.get("/interviews", params={"from": "2026-10-15T00:00:00Z", "to": "2026-12-01T00:00:00Z"})
        assert [i["candidate_name"] for i in r.json()] == ["Bob"]
        assert client.get("/interviews?role_id=999").json() == []


class TestTranscriptUpload:
    def test_upload_parses_segments_and_auto_maps_speakers(self, s3, client, cand):
        iv = _create(client, cand, participants=[{"display_name": "Priya Sharma", "kind": "interviewer"}]).json()
        cand_name_txt = TXT.replace("0:20 - Alice", f"0:20 - {cand.name}")
        r = client.post(f"/interviews/{iv['id']}/upload", files={"file": ("call.txt", cand_name_txt.encode(), "text/plain")})
        assert r.status_code == 200 and r.json()["segments"] == 3

        d = client.get(f"/interviews/{iv['id']}").json()
        kinds = {s["speaker_label"]: s["speaker_kind"] for s in d["speakers"]}
        assert kinds == {"Priya Sharma": "interviewer", cand.name: "candidate", "Unknown Person": "unknown"}
        assert d["segment_count"] == 3 and d["status"] == "completed"

    def test_vtt_upload(self, s3, client, cand):
        iv = _create(client, cand).json()
        vtt = f"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v {cand.name}>Hello there\n"
        r = client.post(f"/interviews/{iv['id']}/upload", files={"file": ("c.vtt", vtt.encode(), "text/vtt")})
        assert r.status_code == 200 and r.json()["segments"] == 1

    def test_unsupported_and_empty_and_garbage(self, s3, client, cand):
        iv = _create(client, cand).json()["id"]
        url = f"/interviews/{iv}/upload"
        assert client.post(url, files={"file": ("a.exe", b"MZ", "application/octet-stream")}).json()["code"] == "unsupported_file"
        assert client.post(url, files={"file": ("a.txt", b"", "text/plain")}).json()["code"] == "empty_file"
        assert client.post(url, files={"file": ("a.docx", b"not a zip", "application/octet-stream")}).status_code == 422

    def test_reupload_replaces_segments(self, s3, client, cand):
        iv = _create(client, cand).json()["id"]
        def up(t):
            return client.post(
                f"/interviews/{iv}/upload", files={"file": ("a.txt", t.encode(), "text/plain")}
            )

        up("0:00 - A\none\n0:05 - B\ntwo\n")
        up("0:00 - A\nonly\n")
        assert client.get(f"/interviews/{iv}/transcript").json()["total"] == 1

    def test_legacy_candidate_transcript_upload_creates_upload_interview(self, s3, client, cand):
        r = client.post(f"/candidates/{cand.id}/transcript", files={"file": ("t.txt", TXT.encode(), "text/plain")})
        assert r.status_code == 200 and r.json()["segments"] == 3
        iv = client.get(f"/interviews/{r.json()['interview_id']}").json()
        assert iv["platform"] == "upload" and iv["segment_count"] == 3
        assert client.get(f"/candidates/{cand.id}").json()["transcript_path"]


class TestTranscriptAndSpeakers:
    @pytest.fixture()
    def iv(self, db_session, org, cand):
        return make_interview(db_session, org.id, cand, [(label, "unknown", text) for label, _, text in SEGMENTS])

    def test_pagination(self, client, iv):
        page = client.get(f"/interviews/{iv.id}/transcript?limit=3&offset=1").json()
        assert page["total"] == 4 and len(page["items"]) == 3 and page["items"][0]["position"] == 1
        assert client.get(f"/interviews/{iv.id}/transcript?limit=0").status_code == 422

    def test_map_speakers_updates_all_segments_of_a_label(self, client, iv):
        parts = {p.display_name: p.id for p in iv.participants}
        r = client.patch(f"/interviews/{iv.id}/speakers", json={"mappings": [
            {"speaker_label": "Alice", "participant_id": parts["Alice"]},
            {"speaker_label": "Priya Sharma", "kind": "interviewer"},
        ]})
        assert r.status_code == 200
        kinds = {s["speaker_label"]: (s["speaker_kind"], s["participant_id"]) for s in r.json()["speakers"]}
        assert kinds == {"Alice": ("candidate", parts["Alice"]), "Priya Sharma": ("interviewer", None)}
        assert all(s["speaker_kind"] != "unknown" for s in client.get(f"/interviews/{iv.id}/transcript").json()["items"])

    def test_map_validation(self, client, iv, db_session, org):
        assert client.patch(f"/interviews/{iv.id}/speakers", json={"mappings": [{"speaker_label": "Nobody", "kind": "candidate"}]}).json()["code"] == "unknown_speaker"
        assert client.patch(f"/interviews/{iv.id}/speakers", json={"mappings": [{"speaker_label": "Alice", "participant_id": 99999}]}).json()["code"] == "bad_participant"
        assert client.patch(f"/interviews/{iv.id}/speakers", json={"mappings": []}).status_code == 422

    def test_foreign_org_cannot_map_or_read(self, other_client, iv):
        assert other_client.get(f"/interviews/{iv.id}/transcript").status_code == 404
        assert other_client.patch(f"/interviews/{iv.id}/speakers", json={"mappings": [{"speaker_label": "Alice", "kind": "candidate"}]}).status_code == 404


class TestVisibilityAndRoles:
    def test_interviewer_sees_only_own_interviews(self, role_client, db_session, org, cand):
        mine = make_interview(db_session, org.id, cand, title="Mine")
        make_interview(db_session, org.id, cand, title="Theirs")
        c = role_client("interviewer")
        from app.models.interview import InterviewParticipant

        db_session.add(InterviewParticipant(interview_id=mine.id, user_id=c.get("/auth/me").json()["user"]["id"], display_name="Me", kind="interviewer"))
        db_session.commit()
        assert [i["title"] for i in c.get("/interviews").json()] == ["Mine"]
        assert c.get(f"/interviews/{mine.id}").status_code == 200

    def test_interviewer_cannot_open_others_interview_or_create(self, role_client, db_session, org, cand):
        other = make_interview(db_session, org.id, cand)
        c = role_client("interviewer")
        assert c.get(f"/interviews/{other.id}").status_code == 404
        assert c.post("/interviews", json={"candidate_id": cand.id, "title": "x"}).status_code == 403

    def test_cancel(self, client, cand):
        iv = _create(client, cand).json()["id"]
        assert client.post(f"/interviews/{iv}/cancel").json()["status"] == "cancelled"


class TestRecording:
    def test_404_without_recording(self, client, db_session, org, cand):
        iv = make_interview(db_session, org.id, cand)
        assert client.get(f"/interviews/{iv.id}/recording").json()["code"] == "no_recording"

    def test_presigned_url_is_short_lived_and_access_is_audited(self, s3, client, db_session, org, cand):
        iv = make_interview(db_session, org.id, cand)
        key = storage.make_key(org.id, "recordings", "opus")
        storage.put(key, b"audio", "audio/ogg")
        db_session.add(Recording(org_id=org.id, interview_id=iv.id, blob_path=key, mime_type="audio/ogg", duration_ms=1000))
        db_session.commit()

        r = client.get(f"/interviews/{iv.id}/recording").json()
        assert r["expires_in"] <= 900 and "X-Amz-Signature" in r["url"] and r["mime_type"] == "audio/ogg"
        assert db_session.query(AuditLog).filter_by(action="recording.accessed", entity_id=str(iv.id)).count() == 1
        assert client.get(f"/interviews/{iv.id}").json()["has_recording"] is True


@pytest.fixture()
def cand_for_null(db_session, org):
    return make_candidate(db_session, org.id, make_role(db_session, org.id, "Null Role").id, "null@example.com")


def test_analysis_endpoint_tolerates_null_json_columns(client, db_session, org, cand_for_null):
    """Older/partial rows may have NULL key_moments/resume_alignment: must not 500."""
    from app.models.analysis import Analysis
    from tests.factories import make_interview

    iv = make_interview(db_session, org.id, cand_for_null)
    db_session.add(Analysis(org_id=org.id, interview_id=iv.id, candidate_id=cand_for_null.id, summary="s",
                            strengths=[], weaknesses=[], key_moments=None, resume_alignment=None,
                            technical_score=1, communication_score=1, confidence_score=1))
    db_session.commit()
    r = client.get(f"/interviews/{iv.id}/analysis")
    assert r.status_code == 200 and r.json()["key_moments"] == [] and r.json()["resume_alignment"] == []
