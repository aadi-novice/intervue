import type { Page } from "playwright";
import type { MeetingAdapter } from "../types.js";

const notImplemented = (): never => {
  throw new Error("Microsoft Teams adapter not implemented yet (M7)");
};

/** Placeholder for M7. `matches` works so the backend gets a clear failure instead of "unsupported URL". */
export class TeamsAdapter implements MeetingAdapter {
  readonly platform = "teams" as const;

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com");
    } catch {
      return false;
    }
  }

  async join(_page: Page, _opts: { botName: string }): Promise<void> {
    notImplemented();
  }
  async waitForAdmission(_page: Page, _timeoutMs: number): Promise<"admitted" | "denied" | "timeout"> {
    return notImplemented();
  }
  async sendChatMessage(_page: Page, _text: string): Promise<void> {
    notImplemented();
  }
  async observeActiveSpeakers(_page: Page, _onEvent: (e: { tMs: number; name: string }) => void): Promise<() => void> {
    return notImplemented();
  }
  async participantCount(_page: Page): Promise<number> {
    return notImplemented();
  }
  async isMeetingEnded(_page: Page): Promise<boolean> {
    return notImplemented();
  }
  async leave(_page: Page): Promise<void> {
    notImplemented();
  }
}
