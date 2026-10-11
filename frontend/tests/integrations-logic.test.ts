import { describe, expect, it } from "vitest";
import {
  apiKeyErrorMessage,
  curlExample,
  deliveryTone,
  displayUrl,
  eventsLabel,
  eventsPayload,
  eventsSelection,
  hasPendingDelivery,
  keyPrefixLabel,
  keyState,
  parseExpiryDays,
  revealTitle,
  revealWarning,
  slackErrorMessage,
  slackHint,
  slackUrlError,
  UNSAFE_URL_MESSAGE,
  VERIFY_NODE,
  VERIFY_PYTHON,
  webhookErrorMessage,
  webhookUrlError,
  webhookUrlShapeError,
} from "@/lib/integrations-logic";

const CAT = ["interview.completed", "analysis.completed", "ranking.completed"];

describe("event selection", () => {
  it("All events sends the wildcard regardless of ticks", () => {
    expect(eventsPayload(true, ["analysis.completed"], CAT)).toEqual(["*"]);
  });
  it("keeps catalogue order and drops unknown events", () => {
    expect(eventsPayload(false, ["ranking.completed", "interview.completed", "bogus"], CAT)).toEqual([
      "interview.completed",
      "ranking.completed",
    ]);
  });
  it("returns null when nothing is chosen", () => {
    expect(eventsPayload(false, [], CAT)).toBeNull();
  });
  it("round-trips for editing", () => {
    expect(eventsSelection(["*"])).toEqual({ all: true, selected: [] });
    expect(eventsSelection(["ranking.completed"])).toEqual({ all: false, selected: ["ranking.completed"] });
    expect(eventsLabel(["*"])).toEqual(["All events"]);
    expect(eventsLabel(["ranking.completed"])).toEqual(["ranking.completed"]);
  });
});

describe("webhook URL validation", () => {
  it("shape check only blocks malformed input", () => {
    expect(webhookUrlShapeError("")).toMatch(/enter/i);
    expect(webhookUrlShapeError("not a url")).toMatch(/full URL/i);
    expect(webhookUrlShapeError("ftp://x.com")).toMatch(/https/);
    expect(webhookUrlShapeError("http://localhost:9000/x")).toBeNull();
  });
  it("advisory check explains private and insecure targets", () => {
    expect(webhookUrlError("https://example.com/hook")).toBeNull();
    expect(webhookUrlError("http://example.com/hook")).toMatch(/https/);
    expect(webhookUrlError("https://localhost/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://10.0.0.5/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://172.20.1.1/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://172.32.1.1/x")).toBeNull();
    expect(webhookUrlError("https://192.168.1.1/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://169.254.169.254/latest")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://[::1]/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://db.internal/x")).toBe(UNSAFE_URL_MESSAGE);
    expect(webhookUrlError("https://user:pw@example.com/x")).toMatch(/username/);
  });
  it("displays host and path without the query string", () => {
    expect(displayUrl("https://hooks.example.com/a/b?token=secret")).toEqual({ host: "hooks.example.com", path: "/a/b" });
    expect(displayUrl("https://hooks.example.com/")).toEqual({ host: "hooks.example.com", path: "" });
  });
});

describe("error code messages", () => {
  it("maps webhook codes", () => {
    expect(webhookErrorMessage({ code: "unsafe_url", detail: "x" })).toMatch(/public https URLs/);
    expect(webhookErrorMessage({ code: "unsafe_url", detail: "x" })).toMatch(/localhost/);
    expect(webhookErrorMessage({ code: "unknown_event", detail: "Unknown event(s): foo" })).toMatch(/foo/);
    expect(webhookErrorMessage({ code: "unresolvable_host", detail: "x" })).toMatch(/resolve that host/);
    expect(webhookErrorMessage({ code: "too_many_endpoints", detail: "x" })).toMatch(/limit/);
    expect(webhookErrorMessage({ code: "other", detail: "Boom" })).toBe("Boom");
    expect(webhookErrorMessage(new Error("net"))).toBe("net");
    expect(webhookErrorMessage(undefined)).toBe("Something went wrong");
  });
  it("maps key and slack codes", () => {
    expect(apiKeyErrorMessage({ code: "too_many_keys" })).toMatch(/limit/);
    expect(apiKeyErrorMessage({ code: "x", detail: "d" })).toBe("d");
    expect(slackErrorMessage({ code: "bad_slack_url" })).toMatch(/Incoming Webhook/);
    expect(slackErrorMessage({ code: "unsafe_url" })).toMatch(/hooks\.slack\.com/);
    expect(slackErrorMessage({ code: "zzz", detail: "d" })).toBe("d");
  });
});

describe("Slack URL pre-validation", () => {
  it("requires the Slack prefix", () => {
    expect(slackUrlError("")).toMatch(/paste/i);
    expect(slackUrlError("https://example.com/services/T000/B000/XXXX")).toMatch(/must start with https:\/\/hooks\.slack\.com\//);
    expect(slackUrlError("https://hooks.slack.com/")).toMatch(/incomplete/);
    expect(slackUrlError("https://hooks.slack.com/services/T000/B000/XXXXXXXX")).toBeNull();
  });
  it("shows only the last four characters", () => {
    expect(slackHint("wxyz")).toBe("Saved webhook ending in …wxyz");
    expect(slackHint("…wxyz")).toBe("Saved webhook ending in …wxyz");
    expect(slackHint(null)).toBe("A webhook is saved");
  });
});

describe("API keys", () => {
  it("parses the expiry field", () => {
    expect(parseExpiryDays("")).toEqual({ ok: true, days: undefined });
    expect(parseExpiryDays(" 30 ")).toEqual({ ok: true, days: 30 });
    expect(parseExpiryDays("730")).toEqual({ ok: true, days: 730 });
    for (const bad of ["0", "731", "-1", "1.5", "abc"]) expect(parseExpiryDays(bad).ok).toBe(false);
  });
  it("formats prefixes and state", () => {
    expect(keyPrefixLabel("1a2b3c4d")).toBe("ik_1a2b3c4d…");
    expect(keyPrefixLabel("ik_1a2b3c4d")).toBe("ik_1a2b3c4d…");
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(keyState({ revoked_at: "2026-01-01T00:00:00Z", expires_at: null }, now)).toBe("revoked");
    expect(keyState({ revoked_at: null, expires_at: "2026-01-05T00:00:00Z" }, now)).toBe("expired");
    expect(keyState({ revoked_at: null, expires_at: "2026-02-05T00:00:00Z" }, now)).toBe("active");
    expect(keyState({ revoked_at: null, expires_at: null }, now)).toBe("active");
  });
  it("builds the curl example", () => {
    expect(curlExample("ik_1_secret", "https://app.example.com/")).toBe(
      'curl https://app.example.com/public/v1/roles \\\n  -H "Authorization: Bearer ik_1_secret"',
    );
  });
});

describe("one-time reveal", () => {
  it("has a clear warning and titles", () => {
    expect(revealWarning("apikey")).toMatch(/won't see it again/);
    expect(revealWarning("webhook")).toMatch(/won't see it again/);
    expect(revealTitle({ kind: "webhook", id: 1, secret: "s", rotated: true })).toMatch(/new signing secret/);
    expect(revealTitle({ kind: "apikey", id: 1, name: "n", key: "k" })).toMatch(/API key/);
  });
  it("verification snippets match the docs", () => {
    expect(VERIFY_PYTHON).toContain("hmac.compare_digest");
    expect(VERIFY_PYTHON).toContain('f"{ts}."');
    expect(VERIFY_NODE).toContain("timingSafeEqual");
    expect(VERIFY_NODE).toContain("`${parts.t}.`");
  });
});

describe("deliveries", () => {
  it("classifies status", () => {
    expect(deliveryTone("success")).toBe("success");
    expect(deliveryTone("failed")).toBe("failed");
    expect(deliveryTone("pending")).toBe("pending");
    expect(hasPendingDelivery([{ status: "success" }, { status: "pending" }])).toBe(true);
    expect(hasPendingDelivery([{ status: "success" }])).toBe(false);
    expect(hasPendingDelivery(undefined)).toBe(false);
  });
});
