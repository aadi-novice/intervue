import { describe, expect, it } from "vitest";
import {
  buildCitations,
  buildSpeakerPayload,
  citationHref,
  detectPlatform,
  draftsFromSpeakers,
  failureMessage,
  FAILURE_MESSAGES,
  FAST_POLL_MS,
  normalizePoint,
  parseSegmentTarget,
  platformHint,
  pollInterval,
  refetchBeforeExpiryMs,
  SLOW_POLL_MS,
} from "@/lib/interviews-logic";

describe("detectPlatform", () => {
  it("detects supported platforms", () => {
    expect(detectPlatform("https://meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(detectPlatform("meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(detectPlatform("https://teams.microsoft.com/l/meetup-join/xyz")).toBe("teams");
    expect(detectPlatform("https://us02web.zoom.us/j/123456")).toBe("zoom");
  });
  it("rejects unknown, lookalike and invalid links", () => {
    expect(detectPlatform("https://example.com/room")).toBeNull();
    expect(detectPlatform("https://meet.google.com.evil.io/x")).toBeNull();
    expect(detectPlatform("not a url at all")).toBeNull();
    expect(detectPlatform("")).toBeNull();
  });
  it("gives friendly hints", () => {
    expect(platformHint("")).toBeNull();
    expect(platformHint("https://example.com")?.ok).toBe(false);
    expect(platformHint("https://zoom.us/j/1")?.text).toMatch(/upload a transcript or recording/i);
    expect(platformHint("https://meet.google.com/aaa-bbbb-ccc")?.ok).toBe(true);
    expect(platformHint("https://teams.microsoft.com/l/meetup-join/x")?.ok).toBe(true);
    expect(platformHint("https://teams.microsoft.com/l/meetup-join/x")?.text).toMatch(/block guests/i);
    expect(platformHint("https://zoom.us/j/1")?.ok).toBe(false);
  });
});

describe("pollInterval", () => {
  it("polls fast while the bot is working", () => {
    for (const s of ["launching", "joining", "waiting_admission", "in_call", "leaving", "processing"]) {
      expect(pollInterval({ botStatus: s })).toBe(FAST_POLL_MS);
    }
  });
  it("polls fast while transcribing or analysing", () => {
    expect(pollInterval({ interviewStatus: "processing" })).toBe(FAST_POLL_MS);
    expect(pollInterval({ analysisStatus: "running" })).toBe(FAST_POLL_MS);
    expect(pollInterval({ analysisStatus: "queued" })).toBe(FAST_POLL_MS);
  });
  it("backs off when scheduled and stops when idle", () => {
    expect(pollInterval({ botStatus: "scheduled" })).toBe(SLOW_POLL_MS);
    expect(pollInterval({ botStatus: "completed", interviewStatus: "completed", analysisStatus: "completed" })).toBe(false);
    expect(pollInterval({ botStatus: "failed" })).toBe(false);
    expect(pollInterval({})).toBe(false);
  });
});

describe("failureMessage", () => {
  it("maps every known reason to a human message", () => {
    for (const code of ["admission_timeout", "blocked_by_host", "guests_not_allowed", "meeting_not_found", "ui_changed", "crash", "launch_failed", "timeout", "cancelled"]) {
      expect(FAILURE_MESSAGES[code]).toBeTruthy();
      expect(failureMessage(code)).toBe(FAILURE_MESSAGES[code]);
    }
  });
  it("falls back gracefully", () => {
    expect(failureMessage("weird", "detail text")).toBe("detail text");
    expect(failureMessage("weird")).toContain("weird");
    expect(failureMessage(null)).toMatch(/unknown/);
  });
});

describe("citations", () => {
  it("builds deep links to transcript segments", () => {
    expect(citationHref(7, 42)).toBe("/interviews/7?tab=transcript&seg=42");
    expect(buildCitations(7, [1, 2])).toEqual([
      { id: 1, href: "/interviews/7?tab=transcript&seg=1" },
      { id: 2, href: "/interviews/7?tab=transcript&seg=2" },
    ]);
    expect(buildCitations(7, undefined)).toEqual([]);
  });
  it("parses ?seg= and #seg- targets", () => {
    expect(parseSegmentTarget("tab=transcript&seg=42")).toBe(42);
    expect(parseSegmentTarget("", "#seg-9")).toBe(9);
    expect(parseSegmentTarget("seg=abc")).toBeNull();
    expect(parseSegmentTarget("")).toBeNull();
  });
  it("normalises both strengths shapes", () => {
    expect(normalizePoint("plain")).toEqual({ text: "plain", segment_ids: [] });
    expect(normalizePoint({ text: "cited", segment_ids: [3, 4] })).toEqual({ text: "cited", segment_ids: [3, 4] });
  });
});

describe("speaker mapping payload", () => {
  const speakers = [
    { speaker_label: "Speaker 1", speaker_kind: "unknown", participant_id: null, segment_count: 3 },
    { speaker_label: "Speaker 2", speaker_kind: "interviewer", participant_id: 5, segment_count: 4 },
  ];
  it("sends only changed rows", () => {
    const original = draftsFromSpeakers(speakers);
    const edited = original.map((d) => (d.speaker_label === "Speaker 1" ? { ...d, kind: "candidate" as const, participant_id: 9 } : d));
    expect(buildSpeakerPayload(original, edited)).toEqual({
      mappings: [{ speaker_label: "Speaker 1", participant_id: 9, kind: "candidate" }],
    });
  });
  it("is empty when nothing changed", () => {
    const original = draftsFromSpeakers(speakers);
    expect(buildSpeakerPayload(original, original).mappings).toHaveLength(0);
  });
});

describe("refetchBeforeExpiryMs", () => {
  it("refetches before expiry but never faster than 30s", () => {
    expect(refetchBeforeExpiryMs(900)).toBe(840_000);
    expect(refetchBeforeExpiryMs(60)).toBe(30_000);
  });
});
