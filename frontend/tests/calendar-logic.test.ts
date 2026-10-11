import { describe, expect, it } from "vitest";
import {
  AUTO_JOIN_OPTIONS,
  autoJoinLabel,
  cleanOAuthParams,
  groupEventsByDay,
  humanize,
  oauthErrorMessage,
  readOAuthResult,
  skipReasonMessage,
} from "@/components/calendar/calendar-logic";
import type { CalendarEvent } from "@/lib/api-calendar";

const ev = (id: number, start: string): CalendarEvent => ({
  id, connection_id: 1, title: `e${id}`, start, end: null, meeting_url: null, platform: null,
  attendees: [], candidate: null, tagged: false, interview_id: null, bot_status: null, skip_reason: null,
});

describe("skipReasonMessage", () => {
  it("maps known codes", () => {
    expect(skipReasonMessage("platform_unsupported")).toBe("Zoom links aren't supported by the notetaker yet (it joins Google Meet and Microsoft Teams).");
    expect(skipReasonMessage("no_candidate_match")).toMatch(/pick one to tag/i);
    expect(skipReasonMessage("bot_already_attempted")).toMatch(/send it manually/);
    expect(skipReasonMessage("role_cannot_schedule_bot")).toMatch(/recruiters/);
  });
  it("humanises unknown codes and ignores empty", () => {
    expect(skipReasonMessage("meeting_not_ready")).toBe("Meeting not ready");
    expect(skipReasonMessage(null)).toBeNull();
    expect(humanize("a_b")).toBe("A b");
  });
});

describe("oauth", () => {
  it("maps error codes", () => {
    expect(oauthErrorMessage("no_refresh_token")).toBe("Google didn't grant offline access: reconnect and accept all permissions.");
    for (const c of ["access_denied", "cancelled", "bad_state", "wrong_org", "oauth_denied", "oauth_failed", "no_account_email"]) {
      expect(oauthErrorMessage(c)).not.toMatch(/Could not connect the calendar \(/);
    }
    expect(oauthErrorMessage("weird_thing")).toContain("Weird thing");
  });
  it("reads results", () => {
    expect(readOAuthResult(new URLSearchParams("tab=integrations&calendar=connected"))).toEqual({ kind: "connected" });
    expect(readOAuthResult(new URLSearchParams("calendar_error=bad_state"))).toEqual({ kind: "error", code: "bad_state" });
    expect(readOAuthResult(new URLSearchParams("tab=integrations"))).toBeNull();
  });
  it("cleans only the result params", () => {
    expect(cleanOAuthParams("/settings", "?tab=integrations&calendar=connected")).toBe("/settings?tab=integrations");
    expect(cleanOAuthParams("/settings", "?calendar_error=x")).toBe("/settings");
  });
});

describe("auto-join options", () => {
  it("has plain-language labels", () => {
    expect(AUTO_JOIN_OPTIONS.map((o) => o.value)).toEqual(["all", "tagged", "never"]);
    expect(autoJoinLabel("tagged")).toBe("Only meetings I tag");
    expect(autoJoinLabel("never")).toBe("Never send the notetaker (still create interviews)");
    expect(autoJoinLabel("all")).toBe("Auto-join every interview with a known candidate");
  });
});

describe("groupEventsByDay", () => {
  it("groups and sorts by local day", () => {
    const g = groupEventsByDay([ev(3, "2030-01-02T10:00:00"), ev(1, "2030-01-01T09:00:00"), ev(2, "2030-01-01T15:00:00")]);
    expect(g).toHaveLength(2);
    expect(g[0].events.map((e) => e.id)).toEqual([1, 2]);
    expect(g[1].events.map((e) => e.id)).toEqual([3]);
  });
});
