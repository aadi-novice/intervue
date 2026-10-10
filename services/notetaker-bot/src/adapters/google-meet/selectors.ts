/**
 * ALL Google Meet selectors live in this file (spec §6.2). When Meet changes its UI,
 * patch this file only. Prefer ARIA roles / accessible names / visible text over class names.
 *
 * The HTML fixtures in tests/fixtures/google-meet/ use the same labels and texts; keep them in sync.
 */
import type { Locator, Page } from "playwright";

// ---------------------------------------------------------------------------
// Visible texts (regexes are case-insensitive and tolerant of curly quotes)
// ---------------------------------------------------------------------------
const Q = "['’]"; // straight or curly apostrophe

export const TEXT = {
  /** Lobby ("knocking") state. */
  lobby: new RegExp(
    `asking to be let in|you${Q}ll join the call when someone lets you in|waiting for (the )?host to let you in|someone will let you in soon`,
    "i",
  ),
  /** Shown instead of the pre-join form when guests cannot join (org-only meeting, etc.). */
  cantJoin: new RegExp(`you can${Q}t join this (video )?call|you cannot join this (video )?call`, "i"),
  /** Host denied the knock / removed the bot while waiting. */
  denied: new RegExp(
    `denied your request to join|your request to join (was|has been) denied|you can${Q}t join this (video )?call|you${Q}ve been removed|you have been removed|removed you from`,
    "i",
  ),
  /** Meet gave up on the knock itself. */
  noResponse: /no one responded to your request|nobody responded to your request|request (to join )?timed out/i,
  /** Invalid / unknown meeting. */
  notFound: new RegExp(
    `check your meeting code|invalid video call name|meeting code (is )?(not valid|invalid)|this meeting link (is|isn${Q}t) (invalid|valid)|couldn${Q}t find (the|this|your) meeting|meeting not found|video call doesn${Q}t exist`,
    "i",
  ),
  /** Post-call screens: we left, the host ended it, or we were removed. */
  ended: new RegExp(
    `you left the meeting|you${Q}ve left the (call|meeting)|the call has ended|this call has ended|the meeting has ended|meeting ended for everyone|call ended for everyone|you${Q}ve been removed from the (meeting|call)|you have been removed from the (meeting|call)|someone in the call removed you|removed you from the (meeting|call)`,
    "i",
  ),
} as const;

// ---------------------------------------------------------------------------
// Accessible-name patterns
// ---------------------------------------------------------------------------
export const NAMES = {
  nameInput: /your name/i,
  joinButton: /^\s*(ask to join|join now|join anyway)\b/i,
  micOff: /turn off microphone/i,
  cameraOff: /turn off camera/i,
  dismiss: /^\s*(got it|dismiss|no thanks|continue without microphone( and camera)?)\s*$/i,
  chatButton: /chat with everyone|open chat|^chat$/i,
  chatInput: /send a message/i,
  sendButton: /send (a )?message/i,
  peopleButton: /^(people|show everyone|participants)\b/i,
  leaveButton: /leave call/i,
  returnHome: /return to home screen|rejoin/i,
} as const;

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
export const sel = {
  nameInput: (p: Page): Locator =>
    p.getByRole("textbox", { name: NAMES.nameInput }).or(p.getByPlaceholder(NAMES.nameInput)).first(),
  joinButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.joinButton }).first(),
  micOffButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.micOff }).first(),
  cameraOffButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.cameraOff }).first(),
  dismissButtons: (p: Page): Locator => p.getByRole("button", { name: NAMES.dismiss }),
  chatButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.chatButton }).first(),
  chatInput: (p: Page): Locator => p.getByRole("textbox", { name: NAMES.chatInput }).first(),
  sendButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.sendButton }).first(),
  peopleButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.peopleButton }).first(),
  leaveButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.leaveButton }).first(),
  returnHomeButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.returnHome }).first(),
  text: (p: Page, re: RegExp): Locator => p.getByText(re).first(),
} as const;

// ---------------------------------------------------------------------------
// Participant count
// ---------------------------------------------------------------------------

/** Extracts the participant count from the People button's aria-label / badge text, e.g. "People - 3 joined", "Show everyone (3)". */
export function parseParticipantCount(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /(\d+)/.exec(label);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Active-speaker detection (runs INSIDE the page via page.evaluate)
// ---------------------------------------------------------------------------

export interface SpeakerDomConfig {
  /** One element per participant tile. `data-participant-id` is a Meet data attribute, not a class. */
  tileSelector: string;
  /** Where to find the display name inside a tile, in priority order. */
  nameSelectors: string[];
  /** Explicit "is speaking" markers (attributes / known class tokens). */
  speakingSelector: string;
  /** Audio-level indicator elements; considered speaking while a CSS animation is running on them or a child. */
  indicatorSelector: string;
  /** Strings stripped from names, e.g. "(You)". */
  nameSuffixes: string[];
}

/**
 * Meet marks the speaking participant's tile with an animated audio indicator. Class names are
 * obfuscated and rotate, so we combine: (1) explicit data attributes, (2) known speaking class
 * tokens observed in the wild (UNVERIFIED - patch here when they rotate), and (3) a generic check
 * for a running CSS animation on any audio-indicator element in the tile.
 */
export const SPEAKER_DOM: SpeakerDomConfig = {
  tileSelector: "[data-participant-id], [data-requested-participant-id]",
  nameSelectors: ["[data-self-name]", "[data-participant-name]", ".notranslate", "[data-tooltip]"],
  speakingSelector: [
    '[data-speaking="true"]',
    '[data-is-speaking="true"]',
    "[data-audio-indicator].speaking",
    // Observed Meet speaking-indicator class tokens (unverified; rotate over time).
    ".Oaajhc",
    ".HX2H7",
    ".wEsLMd",
    ".OgVli",
  ].join(", "),
  indicatorSelector: '[data-audio-indicator], [aria-label*="audio indicator" i], [data-audio-level]',
  nameSuffixes: ["(You)", "(you)", "(Presentation)", "(presenting)"],
};

/**
 * Returns the names of participants whose tiles currently look like they are speaking.
 * Must be self-contained (serialised into the page).
 */
export function detectSpeakingNames(cfg: SpeakerDomConfig): string[] {
  const names = new Set<string>();
  const tiles = Array.from(document.querySelectorAll<HTMLElement>(cfg.tileSelector));

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const isAnimating = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    const anim = cs.animationName && cs.animationName !== "none" && cs.animationPlayState !== "paused";
    if (anim) return true;
    // Web Animations API (covers CSS animations/transitions in Chromium).
    const a = (el as HTMLElement).getAnimations?.() ?? [];
    return a.some((x) => x.playState === "running");
  };

  for (const tile of tiles) {
    let name = "";
    for (const s of cfg.nameSelectors) {
      const el = tile.matches(s) ? tile : tile.querySelector(s);
      if (!el) continue;
      name = (el.getAttribute("data-self-name") || el.getAttribute("data-participant-name") || el.textContent || "").trim();
      if (name) break;
    }
    if (!name) continue;
    for (const suffix of cfg.nameSuffixes) name = name.split(suffix).join("").trim();
    name = name.replace(/\s+/g, " ");
    if (!name) continue;

    let speaking = false;
    const explicit = tile.matches(cfg.speakingSelector) ? tile : tile.querySelector(cfg.speakingSelector);
    if (explicit && isVisible(explicit)) speaking = true;
    if (!speaking) {
      for (const ind of Array.from(tile.querySelectorAll(cfg.indicatorSelector))) {
        if (!isVisible(ind)) continue;
        const level = ind.getAttribute("data-audio-level");
        if (level !== null && Number(level) > 0) {
          speaking = true;
          break;
        }
        if (isAnimating(ind) || Array.from(ind.querySelectorAll("*")).some(isAnimating)) {
          speaking = true;
          break;
        }
      }
    }
    if (speaking) names.add(name);
  }
  return Array.from(names);
}
