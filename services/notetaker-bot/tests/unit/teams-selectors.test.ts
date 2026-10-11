import { describe, expect, it } from "vitest";
import { TeamsAdapter } from "../../src/adapters/teams/index.js";
import { selectAdapter } from "../../src/adapters/index.js";
import {
  classifyMediaToggle,
  cleanParticipantName,
  distinctParticipantCount,
  isTeamsMeetingUrl,
  parseParticipantCount,
  speakingNames,
  TEXT,
} from "../../src/adapters/teams/selectors.js";

describe("Teams URL matching", () => {
  it.each([
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    "https://teams.microsoft.com/meet/123456789012?p=abc",
    "https://teams.live.com/meet/9876543210?p=xyz",
    "https://TEAMS.Microsoft.com/L/Meetup-Join/19%3ameeting_abc",
    "https://Teams.Live.Com/meet/123",
  ])("accepts %s", (url) => {
    expect(isTeamsMeetingUrl(url)).toBe(true);
    expect(new TeamsAdapter().matches(url)).toBe(true);
  });

  it.each([
    "https://teams.microsoft.com.evil.io/l/meetup-join/abc",
    "https://evilteams.microsoft.com/meet/123",
    "https://teams.microsoft.com@evil.io/meet/123",
    "https://evil.io/teams.microsoft.com/meet/123",
    "https://teams.live.com.evil.io/meet/123",
    "https://teams.microsoft.com/",
    "https://teams.microsoft.com/v2/",
    "https://teams.live.com/",
    "http://teams.microsoft.com/meet/123",
    "https://meet.google.com/abc-defg-hij",
    "https://zoom.us/j/123",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isTeamsMeetingUrl(url)).toBe(false);
  });

  it("is picked by selectAdapter; Meet and Zoom stay with their adapters", () => {
    expect(selectAdapter("https://teams.microsoft.com/meet/1?p=2")?.platform).toBe("teams");
    expect(selectAdapter("https://meet.google.com/abc-defg-hij")?.platform).toBe("google_meet");
    expect(selectAdapter("https://zoom.us/j/123")?.platform).toBe("zoom");
    expect(selectAdapter("https://teams.microsoft.com.evil.io/meet/1")).toBeNull();
  });
});

describe("cleanParticipantName", () => {
  it("strips role suffixes", () => {
    expect(cleanParticipantName("Tom Lee (Guest)")).toBe("Tom Lee");
    expect(cleanParticipantName("Intervue Notetaker (You)")).toBe("Intervue Notetaker");
    expect(cleanParticipantName("Ann Wu (External)")).toBe("Ann Wu");
    expect(cleanParticipantName("Ann Wu (Unverified)")).toBe("Ann Wu");
    expect(cleanParticipantName("Ann Wu (guest) ")).toBe("Ann Wu");
  });
  it("strips status words from aria-labels", () => {
    expect(cleanParticipantName("Priya Sharma, Muted")).toBe("Priya Sharma");
    expect(cleanParticipantName("Tom Lee (Guest), speaking")).toBe("Tom Lee");
    expect(cleanParticipantName("Priya Sharma, Muted, Camera off")).toBe("Priya Sharma");
  });
  it("keeps legitimate names", () => {
    expect(cleanParticipantName("Doe, John")).toBe("Doe, John");
    expect(cleanParticipantName("John (Acme)")).toBe("John (Acme)");
    expect(cleanParticipantName("  Mary   Ann  ")).toBe("Mary Ann");
    expect(cleanParticipantName(null)).toBe("");
  });
});

describe("classifyMediaToggle", () => {
  it.each([
    ["Turn camera off", null, "on"],
    ["Turn off camera (Ctrl+Shift+O)", null, "on"],
    ["Mute mic", null, "on"],
    ["Mute microphone (Ctrl+Shift+M)", null, "on"],
    ["Turn camera on", null, "off"],
    ["Unmute mic", null, "off"],
    ["Unmute", null, "off"],
    ["Camera is off", null, "off"],
    ["Camera", "true", "on"],
    ["Microphone", "false", "off"],
    ["Microphone", null, "unknown"],
    ["Audio settings", "true", "unknown"],
    ["Video effects and background settings", null, "unknown"],
  ])("%s / %s -> %s", (label, checked, expected) => {
    expect(classifyMediaToggle(label, checked)).toBe(expected);
  });
});

describe("participant helpers", () => {
  it("parseParticipantCount", () => {
    expect(parseParticipantCount("People (12)")).toBe(12);
    expect(parseParticipantCount("Show participants 4")).toBe(4);
    expect(parseParticipantCount("People")).toBeNull();
    expect(parseParticipantCount(undefined)).toBeNull();
  });
  it("speakingNames cleans and dedupes", () => {
    expect(
      speakingNames([
        { raw: "Tom Lee (Guest)", speaking: true },
        { raw: "Tom Lee, speaking", speaking: true },
        { raw: "Priya Sharma, Muted", speaking: false },
      ]),
    ).toEqual(["Tom Lee"]);
  });
  it("distinctParticipantCount", () => {
    expect(
      distinctParticipantCount([
        { raw: "A B", speaking: false },
        { raw: "a b (Guest)", speaking: false },
        { raw: "C D, Muted", speaking: false },
      ]),
    ).toBe(2);
  });
});

describe("text patterns", () => {
  it("recognise key screens (curly and straight quotes)", () => {
    expect(TEXT.lobby.test("Someone in the meeting should let you in soon")).toBe(true);
    expect(TEXT.cantJoin.test("You can’t join this meeting")).toBe(true);
    expect(TEXT.notFound.test("We couldn't find that meeting")).toBe(true);
    expect(TEXT.denied.test("Sorry, but you were denied access to the meeting.")).toBe(true);
    expect(TEXT.ended.test("You left the meeting")).toBe(true);
    expect(TEXT.ended.test("Someone in the meeting should let you in soon")).toBe(false);
  });
});
