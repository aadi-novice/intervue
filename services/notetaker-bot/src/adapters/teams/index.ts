import type { Locator, Page } from "playwright";
import { AdapterError, type MeetingAdapter } from "../types.js";
import {
  PARTICIPANT_DOM,
  TEXT,
  classifyMediaToggle,
  distinctParticipantCount,
  isTeamsMeetingUrl,
  parseParticipantCount,
  scanParticipants,
  sel,
  speakingNames,
  type MediaKind,
} from "./selectors.js";

export interface TeamsAdapterOptions {
  /** How long to wait for the pre-join screen to render (launcher + pre-join). */
  prejoinTimeoutMs?: number;
  /** Poll interval for state checks. */
  pollMs?: number;
  /** Speaker observation interval (spec: 250 ms). */
  speakerPollMs?: number;
  /** If the pre-join screen is still showing this long after "Join now", fail with ui_changed. */
  prejoinStuckMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function visible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

/**
 * Microsoft Teams (web) adapter, guest join. Selectors and text patterns live in ./selectors.ts.
 * UNVERIFIED against real Teams: only exercised against our own HTML fixtures.
 */
export class TeamsAdapter implements MeetingAdapter {
  readonly platform = "teams" as const;
  private botName = "";
  private prejoinSeenSince: number | null = null;
  private readonly prejoinTimeoutMs: number;
  private readonly pollMs: number;
  private readonly speakerPollMs: number;
  private readonly prejoinStuckMs: number;

  constructor(opts: TeamsAdapterOptions = {}) {
    this.prejoinTimeoutMs = opts.prejoinTimeoutMs ?? 60_000;
    this.pollMs = opts.pollMs ?? 500;
    this.speakerPollMs = opts.speakerPollMs ?? 250;
    this.prejoinStuckMs = opts.prejoinStuckMs ?? 45_000;
  }

  matches(url: string): boolean {
    return isTeamsMeetingUrl(url);
  }

  async join(page: Page, opts: { botName: string }): Promise<void> {
    this.botName = opts.botName;
    this.prejoinSeenSince = null;
    const deadline = Date.now() + this.prejoinTimeoutMs;

    // 1. Get from the launcher interstitial to the pre-join form (or an error screen).
    for (;;) {
      await this.dismissDialogs(page);

      const cont = sel.continueOnBrowser(page);
      if (await visible(cont)) {
        await cont.click({ timeout: 5000 }).catch(() => undefined);
        await sleep(this.pollMs);
        continue;
      }
      if ((await visible(sel.nameInput(page))) || (await visible(sel.joinButton(page)))) break;
      // Only treat a screen as a failure when no usable launcher / pre-join control is showing.
      await this.throwIfFailureScreen(page);
      if (Date.now() > deadline) {
        throw new AdapterError("ui_changed", "Teams pre-join screen not found (no launcher button, name input or Join now)");
      }
      await sleep(this.pollMs);
    }

    // 2. Name, camera off, mic off.
    const nameInput = sel.nameInput(page);
    if (await visible(nameInput)) {
      await nameInput.fill(opts.botName);
    }
    await this.ensureMediaOff(page);
    await this.dismissDialogs(page);

    // 3. Join now.
    const joinButton = sel.joinButton(page);
    try {
      await joinButton.waitFor({ state: "visible", timeout: 15_000 });
      await joinButton.click({ timeout: 15_000 });
    } catch (err) {
      await this.throwIfFailureScreen(page);
      throw new AdapterError("ui_changed", `could not click Join now: ${(err as Error).message}`);
    }
  }

  async waitForAdmission(page: Page, timeoutMs: number): Promise<"admitted" | "denied" | "timeout"> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const inLobby = await visible(sel.text(page, TEXT.lobby));
      if (!inLobby && (await visible(sel.leaveButton(page)))) {
        this.prejoinSeenSince = null;
        await this.ensureMediaOff(page).catch(() => undefined);
        await this.dismissDialogs(page);
        return "admitted";
      }
      if (await visible(sel.text(page, TEXT.denied))) return "denied";
      if (!inLobby) {
        await this.throwIfFailureScreen(page);
        // Still on the pre-join screen long after clicking Join now: the click did not take.
        if (await visible(sel.joinButton(page))) {
          this.prejoinSeenSince ??= Date.now();
          if (Date.now() - this.prejoinSeenSince > this.prejoinStuckMs) {
            throw new AdapterError("ui_changed", "still on the Teams pre-join screen after clicking Join now");
          }
        } else {
          this.prejoinSeenSince = null;
        }
      } else {
        this.prejoinSeenSince = null;
      }
      if (Date.now() >= deadline) return "timeout";
      await sleep(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
    }
  }

  async sendChatMessage(page: Page, text: string): Promise<void> {
    const input = sel.chatInput(page);
    if (!(await visible(input))) {
      await this.openChatPane(page);
      await input.waitFor({ state: "visible", timeout: 8000 });
    }
    await input.click({ timeout: 3000 });
    await input.fill(text);
    await input.press("Enter");
    // Verify the box was cleared (message accepted); otherwise use the send button.
    await sleep(400);
    if ((await this.chatDraft(input)).trim() === text.trim()) {
      await sel.sendButton(page).click({ timeout: 3000 });
      await sleep(400);
      if ((await this.chatDraft(input)).trim() === text.trim()) {
        throw new AdapterError("ui_changed", "Teams chat message was typed but could not be sent");
      }
    }
  }

  async observeActiveSpeakers(page: Page, onEvent: (e: { tMs: number; name: string }) => void): Promise<() => void> {
    const startedAt = Date.now();
    let current: string | null = null;
    let busy = false;
    let stopped = false;
    const self = this.botName.trim().toLowerCase();

    const tick = async () => {
      if (busy || stopped || page.isClosed()) return;
      busy = true;
      try {
        const names = speakingNames(await page.evaluate(scanParticipants, PARTICIPANT_DOM)).filter(
          (n) => n.toLowerCase() !== self && n.toLowerCase() !== "you",
        );
        if (names.length === 0) {
          current = null;
          return;
        }
        // Keep the current speaker while they are still speaking (avoids flapping on overlap).
        const next = current && names.includes(current) ? current : names[0]!;
        if (next !== current) {
          current = next;
          if (!stopped) onEvent({ tMs: Date.now() - startedAt, name: next });
        }
      } catch {
        // Page navigating / closed; the session's end-of-meeting checks handle that.
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void tick(), this.speakerPollMs);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async participantCount(page: Page): Promise<number> {
    const button = sel.peopleButton(page);
    if (await visible(button)) {
      const fromLabel = parseParticipantCount(await button.getAttribute("aria-label"));
      if (fromLabel !== null) return fromLabel;
      const fromText = parseParticipantCount(await button.innerText().catch(() => ""));
      if (fromText !== null) return fromText;
    }
    // Fallback: count distinct tiles / roster rows.
    const tiles = distinctParticipantCount(await page.evaluate(scanParticipants, PARTICIPANT_DOM));
    if (tiles > 0) return tiles;
    throw new Error("participant count unavailable");
  }

  async isMeetingEnded(page: Page): Promise<boolean> {
    if (page.isClosed()) return true;
    if (await visible(sel.text(page, TEXT.ended))) return true;
    if (await visible(sel.rejoinButton(page))) return true;
    return false;
  }

  async leave(page: Page): Promise<void> {
    if (page.isClosed()) return;
    const button = sel.leaveButton(page);
    if (!(await visible(button))) return;
    await button.click({ timeout: 5000 });
    // Some Teams versions ask for confirmation.
    const confirm = sel.leaveConfirm(page);
    await confirm.waitFor({ state: "visible", timeout: 1500 }).then(
      () => confirm.click({ timeout: 3000 }),
      () => undefined,
    );
    await sel.text(page, TEXT.ended).waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
  }

  // -------------------------------------------------------------------------

  private async throwIfFailureScreen(page: Page): Promise<void> {
    if (await visible(sel.text(page, TEXT.notFound))) {
      throw new AdapterError("meeting_not_found", "Teams says the meeting link is invalid or the meeting was not found");
    }
    if (await visible(sel.text(page, TEXT.cantJoin))) {
      throw new AdapterError("guests_not_allowed", "Teams says: you can't join this meeting (guests/anonymous not allowed or sign-in required)");
    }
  }

  private async openChatPane(page: Page): Promise<void> {
    const input = sel.chatInput(page);
    const direct = sel.chatButton(page);
    if (await visible(direct)) {
      await direct.click({ timeout: 5000 });
      return;
    }
    // Narrow layouts hide Chat under "More".
    const more = sel.moreButton(page);
    if (await visible(more)) {
      await more.click({ timeout: 5000 });
      const item = sel.chatMenuItem(page);
      await item.waitFor({ state: "visible", timeout: 3000 });
      await item.click({ timeout: 3000 });
      return;
    }
    if (await visible(input)) return;
    throw new AdapterError("ui_changed", "could not find the Teams Chat button");
  }

  private async chatDraft(input: Locator): Promise<string> {
    return input
      .evaluate((el) => ("value" in el ? String((el as HTMLInputElement).value) : (el.textContent ?? "")))
      .catch(() => "");
  }

  /** Turns camera and microphone OFF on whichever layout is showing (buttons or switches). */
  private async ensureMediaOff(page: Page): Promise<void> {
    for (const kind of ["camera", "mic"] as MediaKind[]) {
      const toggles = sel.mediaToggles(page, kind);
      const count = await toggles.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 8); i++) {
        const el = toggles.nth(i);
        if (!(await visible(el))) continue;
        const label =
          (await el.getAttribute("aria-label").catch(() => null)) ||
          (await el.innerText().catch(() => "")) ||
          (await el.getAttribute("title").catch(() => "")) ||
          "";
        const state = classifyMediaToggle(label, await el.getAttribute("aria-checked").catch(() => null));
        if (state === "on") {
          await el.click({ timeout: 3000 }).catch(() => undefined);
          break;
        }
        if (state === "off") break;
      }
    }
  }

  private async dismissDialogs(page: Page): Promise<void> {
    const buttons = sel.dismissButtons(page);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i);
      if (await visible(b)) await b.click({ timeout: 2000 }).catch(() => undefined);
    }
  }
}
