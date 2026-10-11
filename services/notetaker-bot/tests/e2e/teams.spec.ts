import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { TeamsAdapter } from "../../src/adapters/teams/index.js";
import { AdapterError } from "../../src/adapters/types.js";

// NOTE: these fixtures were written by us to mimic Teams; passing here does NOT prove it works on real Teams.
const fixture = (name: string) =>
  pathToFileURL(path.join(import.meta.dirname, "..", "fixtures", "teams", `${name}.html`)).href;
const open = async (page: Page, name: string, query = "") => {
  await page.goto(fixture(name) + query);
};
const adapter = () => new TeamsAdapter({ prejoinTimeoutMs: 2000, pollMs: 50, speakerPollMs: 50, prejoinStuckMs: 400 });
const state = (page: Page) => page.evaluate(() => (window as any).state);

test.describe("TeamsAdapter against our own fixtures", () => {
  test("join: pre-join with camera/mic buttons: name filled, both off, Join now clicked", async ({ page }) => {
    await open(page, "prejoin");
    await adapter().join(page, { botName: "Intervue Notetaker" });
    expect(await state(page)).toEqual({ micOff: true, camOff: true, joinedName: "Intervue Notetaker" });
    await expect(page.getByText("Someone in the meeting should let you in soon")).toBeVisible();
  });

  test("join: pre-join with camera/mic switches (aria-checked) and data-tid join button", async ({ page }) => {
    await open(page, "prejoin-switches");
    await adapter().join(page, { botName: "Intervue Notetaker" });
    expect(await state(page)).toEqual({ micOff: true, camOff: true, joinedName: "Intervue Notetaker" });
  });

  test("join: devices that are already off stay off", async ({ page }) => {
    await open(page, "prejoin");
    await page.evaluate(() => {
      document.getElementById("cam")!.click();
      document.getElementById("mic")!.click();
    });
    await adapter().join(page, { botName: "Bot" });
    expect(await state(page)).toEqual({ micOff: true, camOff: true, joinedName: "Bot" });
  });

  test("join: launcher interstitial -> Continue on this browser, cookie banner accepted, app buttons untouched", async ({ page }) => {
    await open(page, "launcher");
    await adapter().join(page, { botName: "Intervue Notetaker" });
    const s = await state(page);
    expect(s.clicked).toEqual(["web"]);
    expect(s.cookiesAccepted).toBe(true);
    expect(s).toMatchObject({ micOff: true, camOff: true, joinedName: "Intervue Notetaker" });
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
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.reason).toBe("ui_changed");
  });

  test("waitForAdmission: lobby times out, in-call admitted, denied/removed/ended-while-waiting denied", async ({ page }) => {
    const a = adapter();
    await open(page, "lobby");
    expect(await a.waitForAdmission(page, 300)).toBe("timeout");
    for (const name of ["denied", "removed", "meeting-ended"]) {
      await open(page, name);
      expect(await a.waitForAdmission(page, 2000)).toBe("denied");
    }
    await open(page, "in-call");
    expect(await a.waitForAdmission(page, 2000)).toBe("admitted");
  });

  test("waitForAdmission: failure screens after Join now map to session failure reasons", async ({ page }) => {
    const a = adapter();
    await open(page, "cant-join");
    expect((await a.waitForAdmission(page, 2000).catch((e) => e)).reason).toBe("guests_not_allowed");
    await open(page, "not-found");
    expect((await a.waitForAdmission(page, 2000).catch((e) => e)).reason).toBe("meeting_not_found");
  });

  test("waitForAdmission: stuck on pre-join after clicking Join now reports ui_changed", async ({ page }) => {
    await open(page, "prejoin");
    const err = await adapter().waitForAdmission(page, 3000).catch((e) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.reason).toBe("ui_changed");
  });

  test("sendChatMessage opens the chat pane and posts the text; works when already open", async ({ page }) => {
    const msg = "This meeting is being recorded by Intervue.";
    await open(page, "in-call");
    await adapter().sendChatMessage(page, msg);
    expect(await page.evaluate(() => (window as any).chatMessages)).toEqual([msg]);
    // Pane already open: must not toggle it closed.
    await adapter().sendChatMessage(page, "second");
    expect(await page.evaluate(() => (window as any).chatMessages)).toEqual([msg, "second"]);
  });

  test("sendChatMessage: Chat under More, Send-button fallback when Enter does not send", async ({ page }) => {
    await open(page, "in-call-narrow");
    await adapter().sendChatMessage(page, "hello");
    expect(await page.evaluate(() => (window as any).chatMessages)).toEqual(["hello"]);
    await open(page, "in-call-narrow", "?open");
    await adapter().sendChatMessage(page, "again");
    expect(await page.evaluate(() => (window as any).chatMessages)).toEqual(["again"]);
  });

  test("sendChatMessage throws when there is no chat UI", async ({ page }) => {
    await page.setContent("<h1>nothing</h1>");
    await expect(adapter().sendChatMessage(page, "x")).rejects.toThrow();
  });

  test("participantCount from the People label, falling back to tiles", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    expect(await a.participantCount(page)).toBe(3);
    await page.evaluate(() => (window as any).setPeopleLabel("People (1)"));
    expect(await a.participantCount(page)).toBe(1);
    await page.evaluate(() => (window as any).setPeopleLabel("People"));
    expect(await a.participantCount(page)).toBe(3);
  });

  test("observeActiveSpeakers: emits on change, strips (Guest), ignores the bot", async ({ page }) => {
    const events: { tMs: number; name: string }[] = [];
    const a = adapter();
    await open(page, "prejoin");
    await a.join(page, { botName: "Intervue Notetaker" }); // remembers the bot name
    await open(page, "in-call");
    const stop = await a.observeActiveSpeakers(page, (e) => events.push(e));
    const set = (...n: string[]) => page.evaluate((names) => (window as any).setSpeaking(...names), n);

    await set("Priya Sharma");
    await expect.poll(() => events.map((e) => e.name)).toEqual(["Priya Sharma"]);
    await page.waitForTimeout(300);
    expect(events).toHaveLength(1);

    await set("Tom Lee (Guest)");
    await expect.poll(() => events.map((e) => e.name)).toEqual(["Priya Sharma", "Tom Lee"]);

    await set("Intervue Notetaker (You)");
    await page.waitForTimeout(300);
    expect(events).toHaveLength(2);

    await set();
    await page.waitForTimeout(200);
    await set("Tom Lee (Guest)");
    await expect.poll(() => events.length).toBe(3);
    expect(events[2]!.tMs).toBeGreaterThanOrEqual(events[1]!.tMs);

    stop();
    await set("Priya Sharma");
    await page.waitForTimeout(300);
    expect(events).toHaveLength(3);
  });

  test("observeActiveSpeakers: aria-label 'speaking' variant", async ({ page }) => {
    await open(page, "in-call");
    const events: { tMs: number; name: string }[] = [];
    const stop = await adapter().observeActiveSpeakers(page, (e) => events.push(e));
    await page.evaluate(() =>
      document.querySelector('[data-tid="calling-participant-stream"]')!.setAttribute("aria-label", "Priya Sharma, speaking"),
    );
    await expect.poll(() => events.map((e) => e.name)).toEqual(["Priya Sharma"]);
    stop();
  });

  test("isMeetingEnded: false in call, true on ended / removed screens", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    expect(await a.isMeetingEnded(page)).toBe(false);
    for (const name of ["ended", "removed", "meeting-ended"]) {
      await open(page, name);
      expect(await a.isMeetingEnded(page)).toBe(true);
    }
  });

  test("leave clicks Leave and confirms the dialog", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    await a.leave(page);
    expect(await a.isMeetingEnded(page)).toBe(true);
  });

  test("leave works without a confirmation dialog", async ({ page }) => {
    const a = adapter();
    await open(page, "in-call");
    await page.evaluate(() => ((window as any).leaveNeedsConfirm = false));
    await a.leave(page);
    expect(await a.isMeetingEnded(page)).toBe(true);
  });
});
