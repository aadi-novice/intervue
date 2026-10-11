"""M10b: SSRF guard, webhooks (signing, retries, disabling), API keys + public API, Slack."""

import hashlib
import json
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import httpx
import pytest

from app.core import crypto, ssrf
from app.core.config import settings
from app.core.errors import Invalid
from app.models.analysis import Analysis
from app.models.integrations import ApiKey, WebhookDelivery, WebhookEndpoint
from app.models.notification import Notification
from app.models.tenancy import AuditLog, Membership
from app.services import slack_service, webhook_service
from tests.factories import SEGMENTS, make_candidate, make_interview, make_role

RealClient = httpx.Client
PUBLIC_IP = "93.184.216.34"
HOOK = "https://hooks.example.com/intervue"
SLACK = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX"


@pytest.fixture(autouse=True)
def public_dns():
    """Every hostname resolves to a public address unless a test says otherwise."""
    with patch.object(ssrf, "_resolve", return_value=[PUBLIC_IP]) as r:
        yield r


class Receiver:
    """Fake webhook receiver / Slack served over httpx.MockTransport; records every request."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.exc: Exception | None = None
        self.location: str | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.exc:
            raise self.exc
        headers = {"location": self.location} if self.location else {}
        return httpx.Response(self.status, headers=headers, text="ok" if self.status == 200 else "nope")

    def client(self, *a, **kw) -> httpx.Client:
        return RealClient(transport=httpx.MockTransport(self.handler), follow_redirects=False)

    @property
    def last_json(self):
        return json.loads(self.requests[-1].content)


@pytest.fixture()
def rx():
    r = Receiver()
    with patch("app.services.webhook_service.httpx.Client", side_effect=r.client), patch(
        "app.services.slack_service.httpx.Client", side_effect=r.client
    ):
        yield r


@pytest.fixture()
def role(db_session, org):
    return make_role(db_session, org.id, "Rust Engineer")


@pytest.fixture()
def cand(db_session, org, role):
    return make_candidate(db_session, org.id, role.id, "cara@example.com", name="Cara Candidate")


def create_hook(client, org, **over):
    body = {"url": HOOK, "events": ["*"], "description": "CI", **over}
    r = client.post(f"/orgs/{org.id}/webhooks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ── SSRF guard ────────────────────────────────────────────────────────────────
class TestSsrfGuard:
    @pytest.mark.parametrize("url", [
        "http://hooks.example.com/x",  # plain http
        "https://localhost/x", "https://127.0.0.1/x", "https://127.1.2.3:8443/x", "https://[::1]/x",
        "https://10.0.0.5/x", "https://192.168.1.10/x", "https://172.16.0.1/x",
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata
        "https://[::ffff:127.0.0.1]/x", "https://0.0.0.0/x", "https://224.0.0.1/x",
        "https://metadata.google.internal/x", "https://printer.local/x", "https://db.internal/x",
        "https://user:pass@hooks.example.com/x", "ftp://hooks.example.com/x", "https:///nohost", "not a url",
    ])
    def test_unsafe_targets_are_rejected(self, url):
        with pytest.raises(Invalid) as e:
            ssrf.validate_outbound_url(url)
        assert e.value.code == "unsafe_url"

    def test_hostnames_resolving_to_private_space_are_rejected(self, public_dns):
        for ips in (["10.1.2.3"], ["127.0.0.1"], [PUBLIC_IP, "10.0.0.1"], ["169.254.169.254"], ["fe80::1"]):
            public_dns.return_value = ips
            with pytest.raises(Invalid):
                ssrf.validate_outbound_url("https://evil.example.com/x")

    def test_unresolvable_host_is_rejected(self, public_dns):
        public_dns.side_effect = Invalid("Cannot resolve host", "unresolvable_host")
        with pytest.raises(Invalid) as e:
            ssrf.validate_outbound_url("https://nope.example.com/")
        assert e.value.code == "unresolvable_host"

    def test_public_targets_pass_and_host_allowlist_is_enforced(self):
        assert ssrf.validate_outbound_url("https://hooks.example.com/a?b=1") == "https://hooks.example.com/a?b=1"
        assert ssrf.validate_outbound_url(f"https://{PUBLIC_IP}:8443/x")
        with pytest.raises(Invalid):
            ssrf.validate_outbound_url("https://evil.example.com/", allowed_hosts={"hooks.slack.com"})

    def test_dev_switches_relax_the_rules_explicitly(self):
        with patch.object(settings, "webhook_allow_private", True), patch.object(settings, "webhook_allow_insecure", True):
            assert ssrf.validate_outbound_url("http://localhost:9000/hook")
        with pytest.raises(Invalid):
            ssrf.validate_outbound_url("http://localhost:9000/hook")


# ── signing ───────────────────────────────────────────────────────────────────
class TestSigning:
    BODY = b'{"a":1}'

    def test_roundtrip_and_tamper_detection(self):
        header = webhook_service.sign("whsec_x", int(time.time()), self.BODY)
        assert header.startswith("t=") and ",v1=" in header
        assert webhook_service.verify("whsec_x", header, self.BODY)
        assert not webhook_service.verify("whsec_x", header, self.BODY + b" ")
        assert not webhook_service.verify("whsec_other", header, self.BODY)

    def test_stale_and_malformed_headers_are_rejected(self):
        old = webhook_service.sign("s", int(time.time()) - 3600, self.BODY)
        assert not webhook_service.verify("s", old, self.BODY)
        assert webhook_service.verify("s", old, self.BODY, tolerance=7200)
        for bad in ("", "garbage", "t=abc,v1=00", "v1=00"):
            assert not webhook_service.verify("s", bad, self.BODY)

    def test_signature_matches_the_documented_formula(self):
        import hmac
        ts = 1700000000
        expected = hmac.new(b"sec", f"{ts}.".encode() + self.BODY, hashlib.sha256).hexdigest()
        assert webhook_service.sign("sec", ts, self.BODY) == f"t={ts},v1={expected}"


# ── endpoint management ───────────────────────────────────────────────────────
class TestWebhookManagement:
    def test_secret_is_shown_once_and_stored_encrypted(self, client, db_session, org):
        created = create_hook(client, org)
        assert created["secret"].startswith("whsec_") and created["active"] is True
        assert created["events"] == ["*"]
        listed = client.get(f"/orgs/{org.id}/webhooks").json()
        assert len(listed) == 1 and "secret" not in listed[0] and "secret_enc" not in listed[0]
        ep = db_session.query(WebhookEndpoint).one()
        assert created["secret"] not in ep.secret_enc and crypto.decrypt(ep.secret_enc) == created["secret"]
        audit = db_session.query(AuditLog).filter_by(action="webhook.created").one()
        assert created["secret"] not in json.dumps(audit.metadata_)

    def test_validation(self, client, org, public_dns):
        r = client.post(f"/orgs/{org.id}/webhooks", json={"url": "http://169.254.169.254/x"})
        assert r.status_code == 422 and r.json()["code"] == "unsafe_url"
        r = client.post(f"/orgs/{org.id}/webhooks", json={"url": HOOK, "events": ["interview.deleted"]})
        assert r.status_code == 422 and r.json()["code"] == "unknown_event"
        assert client.post(f"/orgs/{org.id}/webhooks", json={"url": "x" * 2100}).status_code == 422

    def test_event_lists_are_normalised(self, client, org):
        assert create_hook(client, org, events=["analysis.completed", "analysis.completed", "interview.completed"])["events"] == [
            "analysis.completed", "interview.completed"]
        assert create_hook(client, org, events=["analysis.completed", "*"])["events"] == ["*"]
        assert create_hook(client, org, events=None)["events"] == ["*"]
        assert client.get(f"/orgs/{org.id}/webhooks/events").json()["events"] == [
            "interview.completed", "analysis.completed", "ranking.completed"]

    def test_endpoint_cap(self, client, org):
        with patch.object(settings, "webhook_max_endpoints_per_org", 2):
            create_hook(client, org)
            create_hook(client, org)
            r = client.post(f"/orgs/{org.id}/webhooks", json={"url": HOOK})
        assert r.status_code == 409 and r.json()["code"] == "too_many_endpoints"

    def test_update_revalidates_and_reactivation_resets_the_failure_streak(self, client, db_session, org):
        hid = create_hook(client, org)["id"]
        assert client.patch(f"/orgs/{org.id}/webhooks/{hid}", json={"url": "https://10.0.0.1/x"}).status_code == 422
        ep = db_session.get(WebhookEndpoint, hid)
        ep.active, ep.consecutive_failures, ep.disabled_reason = False, 25, "too many"
        db_session.commit()
        out = client.patch(f"/orgs/{org.id}/webhooks/{hid}", json={"active": True, "description": "new", "events": ["ranking.completed"]}).json()
        assert out["active"] is True and out["consecutive_failures"] == 0 and out["disabled_reason"] is None
        assert out["description"] == "new" and out["events"] == ["ranking.completed"]

    def test_rotating_the_secret_issues_a_new_one_once(self, client, db_session, org):
        created = create_hook(client, org)
        new = client.post(f"/orgs/{org.id}/webhooks/{created['id']}/rotate-secret").json()
        assert new["secret"].startswith("whsec_") and new["secret"] != created["secret"]
        assert crypto.decrypt(db_session.get(WebhookEndpoint, created["id"]).secret_enc) == new["secret"]

    def test_delete_removes_the_endpoint_and_its_deliveries(self, client, db_session, org, rx):
        hid = create_hook(client, org)["id"]
        client.post(f"/orgs/{org.id}/webhooks/{hid}/test")
        assert db_session.query(WebhookDelivery).count() == 1
        assert client.delete(f"/orgs/{org.id}/webhooks/{hid}").status_code == 204
        assert db_session.query(WebhookEndpoint).count() == 0 and db_session.query(WebhookDelivery).count() == 0
        assert client.delete(f"/orgs/{org.id}/webhooks/{hid}").status_code == 404

    def test_admin_only_and_org_isolated(self, client, role_client, other_client, org, other_org):
        hid = create_hook(client, org)["id"]
        for role in ("recruiter", "hiring_manager", "interviewer"):
            c = role_client(role)
            assert c.get(f"/orgs/{org.id}/webhooks").status_code == 403
            assert c.post(f"/orgs/{org.id}/webhooks", json={"url": HOOK}).status_code == 403
        assert other_client.get(f"/orgs/{org.id}/webhooks").status_code == 403  # not a member
        # an admin of another org cannot touch this org's endpoint by id through their own org path
        assert other_client.patch(f"/orgs/{other_org.id}/webhooks/{hid}", json={"active": False}).status_code == 404
        assert other_client.get(f"/orgs/{other_org.id}/webhooks/{hid}/deliveries").status_code == 404


# ── delivery ──────────────────────────────────────────────────────────────────
def make_endpoint(db, org, **kw):
    secret = "whsec_testsecret"
    ep = WebhookEndpoint(org_id=org.id, url=kw.pop("url", HOOK), events=kw.pop("events", ["*"]),
                         secret_enc=crypto.encrypt(secret), description="t", **kw)
    db.add(ep)
    db.commit()
    return ep, secret


def make_delivery(db, org, ep, event="analysis.completed", **kw):
    d = WebhookDelivery(org_id=org.id, endpoint_id=ep.id, event=event, event_id="evt_1", status="pending",
                        next_attempt_at=datetime.now(UTC) - timedelta(seconds=1),
                        payload={"id": "evt_1", "type": event, "created_at": "now", "org_id": org.id, "data": {"x": 1}}, **kw)
    db.add(d)
    db.commit()
    return d


class TestDelivery:
    def test_success_is_signed_and_updates_the_endpoint(self, db_session, org, rx):
        ep, secret = make_endpoint(db_session, org, consecutive_failures=3)
        d = make_delivery(db_session, org, ep)
        assert webhook_service.deliver(db_session, d.id) == "success"
        req = rx.requests[0]
        assert str(req.url) == HOOK and req.method == "POST"
        assert req.headers["content-type"] == "application/json" and req.headers["x-intervue-event"] == "analysis.completed"
        assert req.headers["x-intervue-delivery"] == str(d.id) and req.headers["user-agent"].startswith("Intervue-Webhooks")
        assert webhook_service.verify(secret, req.headers["x-intervue-signature"], req.content)
        db_session.refresh(d), db_session.refresh(ep)
        assert (d.status, d.attempts, d.response_code, d.error) == ("success", 1, 200, None)
        assert d.delivered_at and ep.consecutive_failures == 0 and ep.last_success_at

    def test_failures_back_off_then_give_up(self, db_session, org, rx):
        rx.status = 500
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        waits = []
        for attempt in range(1, settings.webhook_max_attempts + 1):
            d.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)  # fast-forward the clock
            db_session.commit()
            status = webhook_service.deliver(db_session, d.id)
            db_session.refresh(d)
            if status == "pending":
                waits.append(round((d.next_attempt_at.replace(tzinfo=UTC) - datetime.now(UTC)).total_seconds()))
        assert d.status == "failed" and d.attempts == settings.webhook_max_attempts and d.next_attempt_at is None
        assert all(abs(w - e) <= 2 for w, e in zip(waits, [30, 120, 600, 3600, 21600])) and len(waits) == 5  # 30s 2m 10m 1h 6h
        assert d.response_code == 500 and d.error == "HTTP 500" and len(rx.requests) == settings.webhook_max_attempts

    def test_a_retry_that_succeeds_clears_the_failure_state(self, db_session, org, rx):
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        rx.status = 503
        webhook_service.deliver(db_session, d.id)
        d.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        db_session.commit()
        rx.status = 200
        assert webhook_service.deliver(db_session, d.id) == "success"
        db_session.refresh(d), db_session.refresh(ep)
        assert d.attempts == 2 and d.error is None and ep.consecutive_failures == 0

    def test_a_delivery_that_is_not_due_is_not_sent_twice(self, db_session, org, rx):
        rx.status = 500
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        webhook_service.deliver(db_session, d.id)
        assert webhook_service.deliver(db_session, d.id) == "pending"  # a racing worker / the sweeper
        assert len(rx.requests) == 1

    def test_redirects_are_never_followed(self, db_session, org, rx):
        rx.status, rx.location = 302, "https://169.254.169.254/latest/meta-data/"
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        webhook_service.deliver(db_session, d.id)
        db_session.refresh(d)
        assert len(rx.requests) == 1 and "redirects are not followed" in d.error

    def test_410_gone_disables_the_endpoint_immediately(self, db_session, org, rx):
        rx.status = 410
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        assert webhook_service.deliver(db_session, d.id) == "failed"
        db_session.refresh(ep)
        assert ep.active is False and "410" in ep.disabled_reason

    def test_network_errors_are_retried_and_recorded(self, db_session, org, rx):
        rx.exc = httpx.ConnectTimeout("timed out")
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        assert webhook_service.deliver(db_session, d.id) == "pending"
        db_session.refresh(d)
        assert d.response_code is None and "ConnectTimeout" in d.error and d.next_attempt_at

    def test_the_target_is_rechecked_at_send_time(self, db_session, org, rx, public_dns):
        ep, _ = make_endpoint(db_session, org)
        d = make_delivery(db_session, org, ep)
        public_dns.return_value = ["10.0.0.7"]  # DNS now points inside the network
        webhook_service.deliver(db_session, d.id)
        db_session.refresh(d)
        assert rx.requests == [] and d.error.startswith("Blocked:")

    def test_repeated_failures_disable_the_endpoint_and_tell_the_admins(self, db_session, org, user, rx):
        rx.status = 500
        ep, _ = make_endpoint(db_session, org)
        with patch.object(settings, "webhook_disable_after_failures", 3):
            for _ in range(3):
                d = make_delivery(db_session, org, ep)
                webhook_service.deliver(db_session, d.id)
        db_session.refresh(ep)
        assert ep.active is False and "3 consecutive" in ep.disabled_reason
        note = db_session.query(Notification).filter_by(kind="webhook_disabled").one()
        assert note.user_id == user.id and note.link == "/settings?tab=integrations"

    def test_deliveries_to_disabled_endpoints_are_dropped_but_pings_still_work(self, db_session, org, rx):
        ep, _ = make_endpoint(db_session, org, active=False)
        real = make_delivery(db_session, org, ep)
        ping = make_delivery(db_session, org, ep, event="ping")
        assert webhook_service.deliver(db_session, real.id) == "failed" and rx.requests == []
        assert webhook_service.deliver(db_session, ping.id) == "success"

    def test_sweeper_picks_up_only_due_pending_deliveries(self, db_session, org):
        ep, _ = make_endpoint(db_session, org)
        due = make_delivery(db_session, org, ep)
        later = make_delivery(db_session, org, ep)
        later.next_attempt_at = datetime.now(UTC) + timedelta(hours=1)
        done = make_delivery(db_session, org, ep)
        done.status = "success"
        db_session.commit()
        assert webhook_service.due_delivery_ids(db_session) == [due.id]
        with patch("app.worker.tasks.integrations.deliver_webhook_task.delay") as delay:
            from app.worker.tasks.integrations import retry_due_task
            assert retry_due_task() == 1
        delay.assert_called_once_with(due.id)
        from app.worker.celery_app import celery_app
        assert celery_app.conf.beat_schedule["webhooks-retry-due"]["schedule"] == 60.0

    def test_test_endpoint_sends_a_ping_and_deliveries_are_listed(self, client, org, rx):
        hid = create_hook(client, org)["id"]
        r = client.post(f"/orgs/{org.id}/webhooks/{hid}/test")
        assert r.status_code == 202 and r.json()["event"] == "ping"
        assert rx.last_json["type"] == "ping" and rx.last_json["data"]["endpoint_id"] == hid
        rows = client.get(f"/orgs/{org.id}/webhooks/{hid}/deliveries").json()
        assert [(d["event"], d["status"], d["response_code"]) for d in rows] == [("ping", "success", 200)]
        assert client.get(f"/orgs/{org.id}/webhooks/{hid}/deliveries?limit=0").status_code == 422


# ── emitting ──────────────────────────────────────────────────────────────────
class TestEmit:
    def test_event_filter_active_flag_and_org_scoping(self, db_session, org, other_org, rx):
        every, _ = make_endpoint(db_session, org)
        only_rank, _ = make_endpoint(db_session, org, events=["ranking.completed"])
        off, _ = make_endpoint(db_session, org, active=False)
        theirs, _ = make_endpoint(db_session, other_org)
        assert webhook_service.emit(db_session, org.id, "analysis.completed", {"interview_id": 1}) == 1
        rows = db_session.query(WebhookDelivery).all()
        assert [r.endpoint_id for r in rows] == [every.id] and len(rx.requests) == 1
        assert {only_rank.id, off.id, theirs.id}.isdisjoint({r.endpoint_id for r in rows})

    def test_envelope_shape_and_one_event_id_across_endpoints(self, db_session, org, rx):
        make_endpoint(db_session, org)
        make_endpoint(db_session, org)
        webhook_service.emit(db_session, org.id, "ranking.completed", {"role_id": 3, "scored": 9})
        ids = {d.event_id for d in db_session.query(WebhookDelivery)}
        body = rx.last_json
        assert len(ids) == 1 and body["id"] in ids and body["id"].startswith("evt_")
        assert (body["type"], body["org_id"], body["data"]) == ("ranking.completed", org.id, {"role_id": 3, "scored": 9})
        assert datetime.fromisoformat(body["created_at"]).tzinfo is not None

    def test_emit_never_breaks_the_caller(self, db_session, org):
        make_endpoint(db_session, org)
        with patch("app.worker.tasks.integrations.deliver_webhook_task.delay", side_effect=RuntimeError("redis down")):
            assert webhook_service.emit(db_session, org.id, "analysis.completed", {"interview_id": 1}) == 0

    def test_analysis_completion_emits_scores_but_no_personal_data(self, client, db_session, org, cand, rx):
        make_endpoint(db_session, org)
        iv = make_interview(db_session, org.id, cand, SEGMENTS)
        cand.resume_path = "k/r.pdf"
        db_session.commit()
        from app.ai.schemas import ClaimCheckOut, InterviewAnalysisOut, InterviewNotesOut
        A = "app.services.analysis_service"
        good = InterviewAnalysisOut(summary="Cara did great", strengths=[], weaknesses=[], key_moments=[],
                                    technical_score=81, communication_score=72, confidence_score=66,
                                    hiring_recommendation="Hire")
        with patch(f"{A}.generate_interview_notes", return_value=InterviewNotesOut(summary="s", key_points=[], topics=[], follow_ups=[])), patch(
            f"{A}.check_resume_claims", return_value=ClaimCheckOut(comparisons=[])), patch(
            f"{A}.extract_text_from_pdf", return_value="resume"), patch(
            f"{A}.generate_interview_analysis", return_value=good):
            assert client.post(f"/interviews/{iv.id}/analysis").status_code == 202
        evt = [json.loads(r.content) for r in rx.requests if json.loads(r.content)["type"] == "analysis.completed"][0]
        assert evt["data"] == {
            "analysis_id": db_session.query(Analysis).one().id, "interview_id": iv.id, "candidate_id": cand.id,
            "role_id": cand.role_id, "technical_score": 81, "communication_score": 72,
            "confidence_score": 66, "hiring_recommendation": "Hire"}
        raw = b"".join(r.content for r in rx.requests).decode()
        assert "Cara" not in raw and "cara@example.com" not in raw and "did great" not in raw

    def test_transcript_upload_emits_interview_completed(self, client, db_session, org, cand, rx):
        from moto import mock_aws
        from app.core import storage
        make_endpoint(db_session, org)
        iv = make_interview(db_session, org.id, cand)
        with mock_aws():
            storage.reset_client()
            storage.ensure_bucket()
            r = client.post(f"/interviews/{iv.id}/upload", files={"file": ("t.txt", b"0:00 - A\nhello\n", "text/plain")})
        storage.reset_client()
        assert r.status_code == 200
        evt = rx.last_json
        assert evt["type"] == "interview.completed" and evt["data"]["interview_id"] == iv.id and evt["data"]["has_transcript"] is True

    def test_ranking_completion_emits_ranking_completed(self, client, db_session, org, role, rx):
        from tests.rank_helpers import fake_ai, make_profile
        make_endpoint(db_session, org)
        c = make_candidate(db_session, org.id, role.id, "r@x.com", name="Rita Rust")
        make_profile(db_session, org.id, c, "rust rust compiler")
        with fake_ai(), patch("app.services.ranking_service.schedule_rank"):
            client.put(f"/roles/{role.id}/rubric", json={"criteria": [{"name": "Rust", "weight": 1, "must_have": False}]})
            client.post(f"/roles/{role.id}/rank")
        evts = [json.loads(r.content) for r in rx.requests if json.loads(r.content)["type"] == "ranking.completed"]
        assert evts and evts[-1]["data"]["role_id"] == role.id and evts[-1]["data"]["scored"] == 1
        assert "Rita" not in b"".join(r.content for r in rx.requests).decode()


# ── API keys + public API ─────────────────────────────────────────────────────
def make_key(client, org, **over):
    r = client.post(f"/orgs/{org.id}/api-keys", json={"name": "Zapier", **over})
    assert r.status_code == 201, r.text
    return r.json()


def auth(key):
    return {"Authorization": f"Bearer {key}"}


class TestApiKeys:
    def test_key_format_shown_once_and_only_the_hash_is_stored(self, client, db_session, org):
        k = make_key(client, org)
        assert k["key"].startswith("ik_") and k["key"].split("_")[1] == k["prefix"] and len(k["prefix"]) == 8
        row = db_session.query(ApiKey).one()
        assert row.key_hash == hashlib.sha256(k["key"].encode()).hexdigest()
        assert k["key"] not in json.dumps([row.key_hash, row.prefix, row.name])
        listed = client.get(f"/orgs/{org.id}/api-keys").json()
        assert listed[0]["prefix"] == k["prefix"] and "key" not in listed[0] and "key_hash" not in listed[0]

    def test_admin_only_cap_and_isolation(self, client, role_client, other_client, org):
        recruiter = role_client("recruiter")
        assert recruiter.post(f"/orgs/{org.id}/api-keys", json={"name": "x"}).status_code == 403
        assert recruiter.get(f"/orgs/{org.id}/api-keys").status_code == 403
        assert other_client.get(f"/orgs/{org.id}/api-keys").status_code == 403
        from app.services import apikey_service
        with patch.object(apikey_service, "MAX_KEYS", 1):
            make_key(client, org)
            r = client.post(f"/orgs/{org.id}/api-keys", json={"name": "two"})
        assert r.status_code == 409 and r.json()["code"] == "too_many_keys"
        assert client.post(f"/orgs/{org.id}/api-keys", json={"name": "x", "expires_in_days": 0}).status_code == 422

    def test_valid_key_authenticates_by_either_header_and_tracks_last_use(self, anon_client, client, db_session, org):
        k = make_key(client, org)["key"]
        assert anon_client.get("/public/v1/me", headers=auth(k)).json() == {
            "organization": {"id": org.id, "name": org.name}, "access": "read-only"}
        assert anon_client.get("/public/v1/me", headers={"X-API-Key": k}).status_code == 200
        assert db_session.query(ApiKey).one().last_used_at is not None

    @pytest.mark.parametrize("bad", [None, "", "ik_", "ik_deadbeef_wrong", "nope", "Bearer"])
    def test_missing_or_malformed_keys_are_rejected_uniformly(self, anon_client, client, org, bad):
        make_key(client, org)
        h = {} if bad is None else {"Authorization": f"Bearer {bad}"}
        r = anon_client.get("/public/v1/me", headers=h)
        assert r.status_code == 401 and r.json()["code"] == "invalid_api_key"

    def test_right_prefix_wrong_secret_is_rejected(self, anon_client, client, org):
        k = make_key(client, org)
        forged = f"ik_{k['prefix']}_{'x' * 43}"
        assert anon_client.get("/public/v1/me", headers=auth(forged)).status_code == 401

    def test_revoked_expired_and_orphaned_keys_stop_working(self, anon_client, client, db_session, org, user):
        revoked = make_key(client, org, name="a")
        assert client.delete(f"/orgs/{org.id}/api-keys/{revoked['id']}").status_code == 204
        assert anon_client.get("/public/v1/me", headers=auth(revoked["key"])).status_code == 401
        assert client.delete(f"/orgs/{org.id}/api-keys/{revoked['id']}").status_code == 204  # idempotent

        expiring = make_key(client, org, name="b", expires_in_days=1)
        assert anon_client.get("/public/v1/me", headers=auth(expiring["key"])).status_code == 200
        db_session.query(ApiKey).filter_by(id=expiring["id"]).update({"expires_at": datetime.now(UTC) - timedelta(minutes=1)})
        db_session.commit()
        assert anon_client.get("/public/v1/me", headers=auth(expiring["key"])).status_code == 401

        orphan = make_key(client, org, name="c")
        db_session.query(Membership).filter_by(user_id=user.id, org_id=org.id).delete()
        db_session.commit()
        assert anon_client.get("/public/v1/me", headers=auth(orphan["key"])).status_code == 401

    def test_keys_and_sessions_are_not_interchangeable(self, anon_client, client, org, user):
        k = make_key(client, org)["key"]
        assert anon_client.get("/roles/", headers={**auth(k), "X-Org-Id": str(org.id)}).status_code == 401
        jwt = client.headers["Authorization"]
        assert anon_client.get("/public/v1/me", headers={"Authorization": jwt}).status_code == 401

    def test_per_key_rate_limit(self, anon_client, client, org):
        k = make_key(client, org)["key"]
        with patch.object(settings, "api_rate_limit_per_hour", 2):
            codes = [anon_client.get("/public/v1/me", headers=auth(k)).status_code for _ in range(4)]
        assert codes == [200, 200, 429, 429]

    def test_revocation_is_audited_without_the_key(self, client, db_session, org):
        k = make_key(client, org)
        client.delete(f"/orgs/{org.id}/api-keys/{k['id']}")
        entries = db_session.query(AuditLog).filter(AuditLog.action.like("api_key.%")).all()
        assert {e.action for e in entries} == {"api_key.created", "api_key.revoked"}
        assert k["key"] not in json.dumps([e.metadata_ for e in entries])


class TestPublicApi:
    @pytest.fixture()
    def key(self, client, org):
        return make_key(client, org)["key"]

    def test_read_endpoints_return_org_data(self, anon_client, db_session, org, role, cand, key):
        iv = make_interview(db_session, org.id, cand, SEGMENTS, title="Interview with Cara", scheduled_start=datetime.now(UTC))
        db_session.add(Analysis(org_id=org.id, interview_id=iv.id, candidate_id=cand.id, role_id=role.id, summary="s",
                                strengths=[], weaknesses=[], technical_score=70, communication_score=60,
                                confidence_score=50, hiring_recommendation="Hire"))
        db_session.commit()
        h = auth(key)
        assert [r["name"] for r in anon_client.get("/public/v1/roles", headers=h).json()] == ["Rust Engineer"]
        cands = anon_client.get("/public/v1/candidates", headers=h).json()
        assert [(c["name"], c["email"]) for c in cands] == [("Cara Candidate", "cara@example.com")]
        ivs = anon_client.get("/public/v1/interviews", headers=h).json()
        assert len(ivs) == 1 and ivs[0]["candidate_name"] == "Cara Candidate"
        assert ivs[0]["title"] == "Interview"  # free-text titles are not exposed
        a = anon_client.get(f"/public/v1/interviews/{iv.id}/analysis", headers=h).json()
        assert (a["technical_score"], a["hiring_recommendation"]) == (70, "Hire")
        assert anon_client.get(f"/public/v1/roles/{role.id}/rankings", headers=h).json()["total"] == 0

    def test_it_is_read_only(self, anon_client, key, role):
        for method, path in (("post", "/public/v1/roles"), ("put", "/public/v1/roles"),
                             ("delete", f"/public/v1/roles/{role.id}"), ("patch", "/public/v1/candidates")):
            assert anon_client.request(method.upper(), path, headers=auth(key), json={}).status_code in (404, 405)

    def test_a_key_never_sees_another_orgs_data(self, anon_client, db_session, org, other_org, key):
        theirs_role = make_role(db_session, other_org.id, "Secret Role")
        theirs = make_candidate(db_session, other_org.id, theirs_role.id, "spy@other.com", name="Spy")
        iv = make_interview(db_session, other_org.id, theirs, SEGMENTS)
        h = auth(key)
        assert anon_client.get("/public/v1/roles", headers=h).json() == []
        assert anon_client.get("/public/v1/candidates", headers=h).json() == []
        assert anon_client.get("/public/v1/interviews", headers=h).json() == []
        assert anon_client.get(f"/public/v1/interviews/{iv.id}/analysis", headers=h).status_code == 404
        assert anon_client.get(f"/public/v1/roles/{theirs_role.id}/rankings", headers=h).status_code == 404

    def test_blind_review_masks_identities_and_a_key_cannot_reveal(self, anon_client, client, db_session, org, role, cand, key):
        from app.models.rubric import RoleMatch
        db_session.add(RoleMatch(org_id=org.id, candidate_id=cand.id, role_id=role.id, status="scored", overall_score=80.0, rubric_scores=[]))
        make_interview(db_session, org.id, cand, SEGMENTS)
        db_session.commit()
        client.patch(f"/orgs/{org.id}/settings", json={"blind_review": True})
        client.post(f"/candidates/{cand.id}/reveal")  # the admin who made the key revealed this candidate
        h = auth(key)
        body = json.dumps([anon_client.get("/public/v1/candidates", headers=h).json(),
                           anon_client.get("/public/v1/interviews", headers=h).json(),
                           anon_client.get(f"/public/v1/roles/{role.id}/rankings", headers=h).json()])
        assert "Cara" not in body and "cara@example.com" not in body and f"Candidate #{cand.id}" in body

    def test_public_reads_never_write_audit_rows(self, anon_client, db_session, org, role, cand, key):
        before = db_session.query(AuditLog).count()
        for path in ("/public/v1/roles", "/public/v1/candidates", "/public/v1/interviews", f"/public/v1/roles/{role.id}/rankings"):
            assert anon_client.get(path, headers=auth(key)).status_code == 200
        assert db_session.query(AuditLog).count() == before

    def test_filters_and_validation(self, anon_client, db_session, org, role, cand, key):
        make_interview(db_session, org.id, cand, scheduled_start=datetime.now(UTC) + timedelta(days=30))
        h = auth(key)
        assert anon_client.get(f"/public/v1/interviews?candidate_id={cand.id}", headers=h).status_code == 200
        assert anon_client.get("/public/v1/interviews?candidate_id=999", headers=h).json() == []
        assert anon_client.get(f"/public/v1/roles/{role.id}/rankings?limit=0", headers=h).status_code == 422
        assert anon_client.get(f"/public/v1/roles/{role.id}/rankings?min_score=101", headers=h).status_code == 422


# ── Slack ─────────────────────────────────────────────────────────────────────
class TestSlack:
    def test_configure_stores_the_url_encrypted_and_never_returns_it(self, client, db_session, org):
        r = client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        assert r.status_code == 200
        out = r.json()
        assert out["configured"] is True and out["hint"] == "…" + SLACK[-4:] and SLACK not in r.text
        assert out["events"] == sorted(slack_service.EVENTS)
        from app.models.tenancy import Organization
        db_session.expire_all()
        stored = db_session.get(Organization, org.id).settings
        assert SLACK not in json.dumps(stored) and crypto.decrypt(stored["slack_webhook_enc"]) == SLACK
        # it must not leak through any other endpoint either
        for body in (client.get("/auth/me").text, client.get("/orgs/me").text,
                     client.patch(f"/orgs/{org.id}/settings", json={"blind_review": False}).text,
                     client.get(f"/orgs/{org.id}/slack").text):
            assert SLACK not in body and "slack_webhook_enc" not in body

    @pytest.mark.parametrize("url", [
        "https://evil.example.com/services/T000/B000/XXXXXXXXXXXXXXXX", "http://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX",
        "https://hooks.slack.com.evil.io/services/T000/B000/XXXXXXXXXXXXXXXX", "https://hooks.slack.com/other/T0/B0/XXXXXXXXXX",
        "https://hooks.slack.com/services/", "https://user@hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX", "",
    ])
    def test_only_real_slack_webhook_urls_are_accepted(self, client, org, url):
        r = client.put(f"/orgs/{org.id}/slack", json={"webhook_url": url})
        assert r.status_code == 422 and r.json()["code"] in ("bad_slack_url", "unsafe_url")

    def test_event_validation_and_defaults(self, client, org):
        assert client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK, "events": ["nope"]}).json()["code"] == "unknown_event"
        out = client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK, "events": ["bot.failed", "bot.failed"]}).json()
        assert out["events"] == ["bot.failed"]

    def test_slack_keys_cannot_be_set_through_the_org_settings_endpoint(self, client, db_session, org):
        client.patch(f"/orgs/{org.id}/settings", json={"slack_webhook_enc": "x", "slack_events": ["x"], "blind_review": True})
        from app.models.tenancy import Organization
        db_session.expire_all()
        s = db_session.get(Organization, org.id).settings
        assert "slack_webhook_enc" not in s and s["blind_review"] is True

    def test_test_message_posts_to_slack(self, client, org, rx):
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        r = client.post(f"/orgs/{org.id}/slack/test")
        assert r.json() == {"ok": True, "error": None}
        assert str(rx.requests[0].url) == SLACK and "connected" in rx.last_json["text"]

    def test_failures_are_recorded_for_the_admin_to_see(self, client, org, rx):
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        rx.status = 404
        r = client.post(f"/orgs/{org.id}/slack/test").json()
        assert r["ok"] is False and "404" in r["error"]
        assert "404" in client.get(f"/orgs/{org.id}/slack").json()["last_error"]
        rx.status = 200
        client.post(f"/orgs/{org.id}/slack/test")
        assert client.get(f"/orgs/{org.id}/slack").json()["last_error"] is None

    def test_events_are_announced_only_when_enabled_and_without_names(self, client, db_session, org, role, cand, rx):
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK, "events": ["analysis.completed"]})
        webhook_service.emit(db_session, org.id, "ranking.completed", {"role_id": role.id, "scored": 3})
        assert rx.requests == []  # not enabled
        webhook_service.emit(db_session, org.id, "analysis.completed", {
            "interview_id": 7, "candidate_id": cand.id, "role_id": role.id, "technical_score": 80,
            "communication_score": 70, "confidence_score": 60, "hiring_recommendation": "Hire"})
        text = rx.last_json["text"]
        assert "interview #7" in text and "Rust Engineer" in text and "*Hire*" in text and "Final decision by your team" in text
        assert f"{settings.frontend_url}/interviews/7?tab=analysis" in text
        assert "Cara" not in text and "cara@example.com" not in text

    def test_bot_failure_is_announced(self, client, db_session, org, rx):
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        db_session.expire_all()  # the PUT ran in the API's own session
        assert slack_service.announce(db_session, org.id, "bot.failed", {"interview_id": 5, "reason": "admission_timeout"})
        assert "interview #5" in rx.last_json["text"] and "admission_timeout" in rx.last_json["text"]

    def test_clear_admin_only_and_isolated(self, client, role_client, other_client, org, other_org):
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        recruiter = role_client("recruiter")
        for call in (lambda: recruiter.get(f"/orgs/{org.id}/slack"), lambda: recruiter.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK}),
                     lambda: recruiter.delete(f"/orgs/{org.id}/slack"), lambda: recruiter.post(f"/orgs/{org.id}/slack/test")):
            assert call().status_code == 403
        assert other_client.get(f"/orgs/{org.id}/slack").status_code == 403
        assert other_client.get(f"/orgs/{other_org.id}/slack").json()["configured"] is False
        out = client.delete(f"/orgs/{org.id}/slack").json()
        assert out["configured"] is False and out["events"] == []

    def test_export_never_contains_the_slack_url(self, client, db_session, org):
        from moto import mock_aws
        from app.core import storage
        from app.models.job import Job
        import io
        import zipfile
        client.put(f"/orgs/{org.id}/slack", json={"webhook_url": SLACK})
        with mock_aws():
            storage.reset_client()
            storage.ensure_bucket()
            client.post(f"/orgs/{org.id}/exports", json={})
            key = db_session.query(Job).filter_by(kind="export").one().result["key"]
            z = zipfile.ZipFile(io.BytesIO(storage.get(key)))
            blob = b"".join(z.read(n) for n in z.namelist()).decode(errors="ignore")
        storage.reset_client()
        assert SLACK not in blob and "slack_webhook_enc" not in blob
