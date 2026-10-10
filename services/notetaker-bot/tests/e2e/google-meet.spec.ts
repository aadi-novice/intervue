import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { GoogleMeetAdapter } from "../../src/adapters/google-meet/index.js";
import { AdapterError } from "../../src/adapters/types.js";
import { parseParticipantCount } from "../../src/adapters/google-meet/selectors.js";

const fixture = (name: string) => pathToFileURL(path.join(import.meta.dirname, "..", "fixtures", "google-meet", `${name}.html`)).href;
const open = async (page: Page, name: string) => {
  await page.goto(fixture(name));
};
const adapter = () => new GoogleMeetAdapter({ prejoinTimeoutMs: 2000, pollMs: 50, speakerPollMs: 50 });

test.describe("GoogleMeetAdapter against recorded fixtures", () => {
  test("matches only meet.google.com https urls", () => {
    const a = adapter();
    expect(a.matches("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(a.matches("https://meet.google.com.evil.com/abc")).toBe(false);
    expect(a.matches("https://zoom.us/j/1")).toBe(false);
    expect(a.matches("not a url")).toBe(false);
  });

  test("join: fills the name, turns mic and camera off, asks to join", async ({ page }) => {
    await open(page, "prejoin");
    await adapter().join(page, { botName: "Intervue Notetaker" });
    const state = await page.evaluate(() => (window as any).state);
    expect(state).toEqual({ micOff: true, camOff: true, joinedName: "Intervue Notetaker" });
    await expect(page.getByText("Asking to be let in")).toBeVisible();
  });

  test("join: guests not allowed", async ({ page }) => {
    await open(page, "cant-join");
    const err = await adapter().join(page, { botName: "Bot" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.reason).toBe("guests_not_allowed");
  });

  test("join: meeting not found", async ({ page }) => {
    await open(page, "not-found");
    const err = await adapter().join(page, { botName: "Bot" }).catch((e) => e);
    expect(err.reason).toBe("meeting_not_found");
  });

  test("join: unknown screen reports ui_changed", async ({ page }) => {
    await page.setContent("<h1>Something totally different</h1>");
    const err = await adapter().join(page, { botName: "Bot" }).catch((e) => e);
    expect(err.reason).toBe("ui_changed");
  });

  test("waitForAdmission: lobby times out, in-call is admitted, denied is denied", async ({ page }) => {
    const a = adapter();
    await open(page, "lobby");
    expect(await a.waitForAdmission(page, 400)).toBe("timeout");
    await open(page, "denied");
    expect(await a.waitForAdmission(page, 2000)).toBe("denied");
    await open(page, "removed");
    expect(await a.waitForAdmission(page, 2000)).toBe("denied");
    await open(page, "in-call");
    expect(await a.waitForAdmission(page, 2000)).toBe("admitted");
  });

  test("sendChatMessage opens the chat panel and posts the text", async ({ page }) => {
    await open(page, "in-call");
    const msg = "This meeting is being recorded by Intervue.";
    await adapter().sendChatMessage(page, msg);
    expect(await page.evaluate(() => (window as any).chatMessages)).toEqual([msg]);
  });

  test("participantCount from the People aria-label, falling back to tiles", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    expect(await a.participantCount(page)).toBe(3);
    await page.evaluate(() => (window as any).setPeopleLabel("People - 1 joined"));
    expect(await a.participantCount(page)).toBe(1);
    await page.evaluate(() => (window as any).setPeopleLabel("People"));
    expect(await a.participantCount(page)).toBe(3);
  });

  test("parseParticipantCount", () => {
    expect(parseParticipantCount("People - 12 joined")).toBe(12);
    expect(parseParticipantCount("Show everyone (4)")).toBe(4);
    expect(parseParticipantCount("People")).toBeNull();
    expect(parseParticipantCount(null)).toBeNull();
  });

  test("observeActiveSpeakers emits on change only and ignores the bot itself", async ({ page }) => {
    await open(page, "in-call");
    const events: { tMs: number; name: string }[] = [];
    const stop = await adapter().observeActiveSpeakers(page, (e) => events.push(e));
    const set = (...n: string[]) => page.evaluate((names) => (window as any).setSpeaking(...names), n);

    await set("Priya Sharma");
    await expect.poll(() => events.map((e) => e.name)).toEqual(["Priya Sharma"]);
    await page.waitForTimeout(300); // same speaker: no duplicate
    expect(events).toHaveLength(1);

    await set("Tom Lee");
    await expect.poll(() => events.map((e) => e.name)).toEqual(["Priya Sharma", "Tom Lee"]);

    await set("Intervue Notetaker"); // the bot (shown as "(You)") is not reported
    await page.waitForTimeout(300);
    expect(events).toHaveLength(2);

    await set(); // silence, then the same person speaking again is a new event
    await page.waitForTimeout(200);
    await set("Tom Lee");
    await expect.poll(() => events.length).toBe(3);
    expect(events[2]!.tMs).toBeGreaterThanOrEqual(events[1]!.tMs);

    stop();
    await set("Priya Sharma");
    await page.waitForTimeout(300);
    expect(events).toHaveLength(3);
  });

  test("isMeetingEnded: false in call, true on ended / removed screens", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    expect(await a.isMeetingEnded(page)).toBe(false);
    await open(page, "ended");
    expect(await a.isMeetingEnded(page)).toBe(true);
    await open(page, "removed");
    expect(await a.isMeetingEnded(page)).toBe(true);
  });

  test("leave clicks Leave call", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    await a.leave(page);
    expect(await a.isMeetingEnded(page)).toBe(true);
  });
});
