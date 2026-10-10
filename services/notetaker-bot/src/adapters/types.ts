import type { Page } from "playwright";
import type { FailureReason } from "../backend-client.js";

export type Platform = "google_meet" | "teams" | "zoom";

/** Platform adapter contract (spec §6.2). */
export interface MeetingAdapter {
  platform: Platform;
  matches(url: string): boolean;
  join(page: Page, opts: { botName: string }): Promise<void>;
  waitForAdmission(page: Page, timeoutMs: number): Promise<"admitted" | "denied" | "timeout">;
  sendChatMessage(page: Page, text: string): Promise<void>;
  observeActiveSpeakers(page: Page, onEvent: (e: { tMs: number; name: string }) => void): Promise<() => void>;
  participantCount(page: Page): Promise<number>;
  isMeetingEnded(page: Page): Promise<boolean>;
  leave(page: Page): Promise<void>;
}

/**
 * Thrown by adapters when the platform tells us why we cannot continue.
 * The session maps `reason` straight onto the `failed` event.
 */
export class AdapterError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
