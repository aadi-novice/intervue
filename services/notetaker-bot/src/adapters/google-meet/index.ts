import type { Page } from "playwright";
import { AdapterError, type MeetingAdapter } from "../types.js";
import { SPEAKER_DOM, TEXT, detectSpeakingNames, parseParticipantCount, sel } from "./selectors.js";

export interface GoogleMeetAdapterOptions {
  /** How long to wait for the pre-join screen to render. */
  prejoinTimeoutMs?: number;
  /** Poll interval for state checks. */
  pollMs?: number;
  /** Speaker observation interval (spec: 250 ms). */
  speakerPollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function visible(locator: ReturnType<typeof sel.text>): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

export class GoogleMeetAdapter implements MeetingAdapter {
  readonly platform = "google_meet" as const;
  private botName = "";
  private readonly prejoinTimeoutMs: number;
  private readonly pollMs: number;
  private readonly speakerPollMs: number;

  constructor(opts: GoogleMeetAdapterOptions = {}) {
    this.prejoinTimeoutMs = opts.prejoinTimeoutMs ?? 60_000;
    this.pollMs = opts.pollMs ?? 500;
    this.speakerPollMs = opts.speakerPollMs ?? 250;
  }

  matches(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && u.hostname === "meet.google.com";
    } catch {
      return false;
    }
  }

  async join(page: Page, opts: { botName: string }): Promise<void> {
    this.botName = opts.botName;
    const deadline = Date.now() + this.prejoinTimeoutMs;

    // 1. Wait for the pre-join form (or an error screen).
    for (;;) {
      await this.dismissDialogs(page);
      if (await visible(sel.text(page, TEXT.notFound))) {
        throw new AdapterError("meeting_not_found", "Meet says the meeting code / link is invalid");
      }
      if (await visible(sel.text(page, TEXT.cantJoin))) {
        throw new AdapterError("guests_not_allowed", "Meet says: you can't join this call (guests not allowed)");
      }
      if ((await visible(sel.nameInput(page))) || (await visible(sel.joinButton(page)))) break;
      if (Date.now() > deadline) {
        throw new AdapterError("ui_changed", "pre-join screen not found (no name input or join button)");
      }
      await sleep(this.pollMs);
    }

    // 2. Name, mic off, camera off.
    const nameInput = sel.nameInput(page);
    if (await visible(nameInput)) {
      await nameInput.fill(opts.botName);
    }
    await this.ensureMediaOff(page);
    await this.dismissDialogs(page);

    // 3. Ask to join / Join now.
    const joinButton = sel.joinButton(page);
    try {
      await joinButton.waitFor({ state: "visible", timeout: 15_000 });
      // Meet keeps the button disabled until a name is entered.
      await joinButton.click({ timeout: 15_000 });
    } catch (err) {
      if (await visible(sel.text(page, TEXT.cantJoin))) {
        throw new AdapterError("guests_not_allowed", "Meet says: you can't join this call");
      }
      throw new AdapterError("ui_changed", `could not click join button: ${(err as Error).message}`);
    }
  }

  async waitForAdmission(page: Page, timeoutMs: number): Promise<"admitted" | "denied" | "timeout"> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await visible(sel.leaveButton(page))) {
        await this.ensureMediaOff(page).catch(() => undefined);
        await this.dismissDialogs(page);
        return "admitted";
      }
      if (await visible(sel.text(page, TEXT.denied))) return "denied";
      if (await visible(sel.text(page, TEXT.noResponse))) return "timeout";
      if (Date.now() >= deadline) return "timeout";
      await sleep(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
    }
  }

  async sendChatMessage(page: Page, text: string): Promise<void> {
    const input = sel.chatInput(page);
    if (!(await visible(input))) {
      const button = sel.chatButton(page);
      await button.click({ timeout: 5000 });
      await input.waitFor({ state: "visible", timeout: 5000 });
    }
    await input.click({ timeout: 3000 });
    await input.fill(text);
    await input.press("Enter");
    // Verify the input was cleared (message accepted); otherwise fall back to the send button.
    await sleep(300);
    const remaining = await input.inputValue().catch(() => "");
    if (remaining.trim() === text.trim()) {
      const send = sel.sendButton(page);
      await send.click({ timeout: 3000 });
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
        const names = (await page.evaluate(detectSpeakingNames, SPEAKER_DOM)).filter(
          (n) => n.trim().toLowerCase() !== self && n.trim().toLowerCase() !== "you",
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
    // Fallback: count distinct participant tiles.
    const tiles = await page.evaluate((tileSelector) => {
      const ids = new Set<string>();
      for (const el of Array.from(document.querySelectorAll(tileSelector))) {
        ids.add(el.getAttribute("data-participant-id") ?? el.getAttribute("data-requested-participant-id") ?? "");
      }
      ids.delete("");
      return ids.size;
    }, SPEAKER_DOM.tileSelector);
    if (tiles > 0) return tiles;
    throw new Error("participant count unavailable");
  }

  async isMeetingEnded(page: Page): Promise<boolean> {
    if (page.isClosed()) return true;
    if (await visible(sel.text(page, TEXT.ended))) return true;
    if (await visible(sel.returnHomeButton(page))) return true;
    return false;
  }

  async leave(page: Page): Promise<void> {
    if (page.isClosed()) return;
    const button = sel.leaveButton(page);
    if (await visible(button)) {
      await button.click({ timeout: 5000 });
      await sel.text(page, TEXT.ended).waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
    }
  }

  private async ensureMediaOff(page: Page): Promise<void> {
    for (const button of [sel.micOffButton(page), sel.cameraOffButton(page)]) {
      if (await visible(button)) {
        await button.click({ timeout: 3000 }).catch(() => undefined);
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
