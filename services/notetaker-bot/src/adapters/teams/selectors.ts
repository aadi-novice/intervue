/**
 * ALL Microsoft Teams (web, guest join) selectors, texts and heuristics live in this file (spec §6.2).
 * When Teams changes its UI, patch this file only.
 *
 * Order of preference: ARIA roles / accessible names / visible text, then `data-tid` attributes, never class names.
 *
 * HONESTY NOTE: none of this has been run against real Teams. The HTML fixtures in tests/fixtures/teams/ were
 * written by us from memory of the Teams web UI and use the same labels/texts. Everything marked
 * `UNVERIFIED against real Teams` is a best guess. Teams differs between tenants, rollout rings and A/B tests.
 */
import type { Locator, Page } from "playwright";

// ---------------------------------------------------------------------------
// URL matching
// ---------------------------------------------------------------------------

/**
 * Accepts https://teams.microsoft.com/l/meetup-join/..., https://teams.microsoft.com/meet/...,
 * https://teams.live.com/meet/... Host comparison is exact (case-insensitive by URL parsing), so look-alikes such as
 * teams.microsoft.com.evil.io or evilteams.microsoft.com are rejected.
 */
export function isTeamsMeetingUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host === "teams.microsoft.com") {
    return /^\/l\/meetup-join\/.+/.test(path) || /^\/meet\/.+/.test(path);
  }
  if (host === "teams.live.com") {
    return /^\/meet\/.+/.test(path);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Visible texts (case-insensitive, tolerant of curly quotes)
// ---------------------------------------------------------------------------
const Q = "['’]"; // straight or curly apostrophe

export const TEXT = {
  /** Lobby / waiting room. UNVERIFIED against real Teams. */
  lobby: new RegExp(
    `someone in the meeting should let you in soon|someone will let you in soon|waiting for (someone|the (host|organi[sz]er)) to let you in|you${Q}re in the lobby|waiting room|we${Q}ve let (them|the organi[sz]er) know you${Q}re (here|waiting)|when the meeting starts, we${Q}ll let people know you${Q}re waiting`,
    "i",
  ),
  /**
   * Guests / anonymous users cannot join (tenant policy), or sign-in is required.
   * UNVERIFIED against real Teams (wording varies by tenant and rollout).
   */
  cantJoin: new RegExp(
    `you can${Q}t join this meeting|you cannot join this meeting|anonymous (users|people|participants)? ?(can${Q}t|cannot|aren${Q}t allowed|are not allowed)|guests? (are not|aren${Q}t) allowed|not available to (guests|anonymous)|sign in to join this meeting|you need to sign in to join|only people (in|with)[^.]{0,80}can join|your organi[sz]ation (doesn${Q}t|does not) allow`,
    "i",
  ),
  /** Invalid / unknown meeting link. UNVERIFIED against real Teams. */
  notFound: new RegExp(
    `we couldn${Q}t find (that|this|the) meeting|couldn${Q}t find (that|this|the) meeting|meeting not found|this meeting (link )?(is|isn${Q}t) (invalid|valid)|meeting (link|id) (is )?(invalid|not valid)|that meeting (link )?doesn${Q}t exist|the meeting you${Q}re trying to join (doesn${Q}t exist|has expired)`,
    "i",
  ),
  /** Host declined the knock / removed us / ended the meeting while we were waiting. UNVERIFIED against real Teams. */
  denied: new RegExp(
    `you were denied access|denied (access|your request)|someone in the meeting denied|request to join (was|has been) denied|you${Q}ve been removed|you have been removed|you were removed|removed (you )?from (this|the) meeting|the meeting has ended|this meeting has ended|meeting ended`,
    "i",
  ),
  /** Post-call screens: we left, the host ended it, or we were removed. UNVERIFIED against real Teams. */
  ended: new RegExp(
    `you left the meeting|you${Q}ve left the meeting|the meeting has ended|this meeting has ended|meeting ended|the meeting ended for everyone|you${Q}ve been removed from (this|the) meeting|you have been removed from (this|the) meeting|you were removed from (this|the) meeting|removed you from (this|the) meeting`,
    "i",
  ),
} as const;

// ---------------------------------------------------------------------------
// Accessible-name patterns
// ---------------------------------------------------------------------------
export const NAMES = {
  /** Launcher interstitial. "Join on the web instead" is the variant used on /meet/ links. UNVERIFIED. */
  continueOnBrowser: /continue on this browser|join on the web instead|use the web app instead|continue as (a )?guest|join as (a )?guest/i,
  /** Name field on the pre-join screen. */
  nameInput: /type your name|enter (your )?name|your name/i,
  joinButton: /^\s*(join now|join meeting|join anyway)\b/i,
  /** Banners / dialogs that can sit on top of the pre-join (cookie consent, "get the app", tips). */
  dismiss: /^\s*(accept( all)?|got it|dismiss|not now|no thanks|maybe later|continue without (audio|video|audio or video|microphone|camera)( (or|and) (video|camera))?)\s*$/i,
  chatButton: /^\s*chat\b/i,
  moreButton: /^\s*(more|more actions|more options)\b/i,
  chatMenuItem: /^\s*chat\b/i,
  chatInput: /type a (new )?message/i,
  sendButton: /^\s*send\b/i,
  peopleButton: /^\s*(people|participants|roster|show (participants|people|everyone))\b/i,
  leaveButton: /^\s*(leave|hang up)\b/i,
  leaveConfirm: /^\s*leave( meeting)?\s*$/i,
  rejoin: /^\s*rejoin\b/i,
} as const;

/** `data-tid` fallbacks (second preference). All UNVERIFIED against real Teams. */
export const TID = {
  continueOnBrowser: '[data-tid="joinOnWeb"]',
  nameInput: '[data-tid="prejoin-display-name-input"]',
  joinButton: '[data-tid="prejoin-join-button"]',
  hangup: '[data-tid="hangup-button"]',
  chatInput: '[data-tid="ckeditor"]',
  chatButton: '[data-tid="chat-button"]',
  sendButton: '[data-tid="newMessageCommands-send"]',
} as const;

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
export const sel = {
  continueOnBrowser: (p: Page): Locator =>
    p
      .getByRole("button", { name: NAMES.continueOnBrowser })
      .or(p.getByRole("link", { name: NAMES.continueOnBrowser }))
      .or(p.locator(TID.continueOnBrowser))
      .first(),
  nameInput: (p: Page): Locator =>
    p
      .getByRole("textbox", { name: NAMES.nameInput })
      .or(p.getByPlaceholder(NAMES.nameInput))
      .or(p.locator(TID.nameInput))
      .first(),
  joinButton: (p: Page): Locator =>
    p.getByRole("button", { name: NAMES.joinButton }).or(p.locator(TID.joinButton)).first(),
  dismissButtons: (p: Page): Locator => p.getByRole("button", { name: NAMES.dismiss }),
  chatButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.chatButton }).or(p.locator(TID.chatButton)).first(),
  moreButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.moreButton }).first(),
  chatMenuItem: (p: Page): Locator =>
    p.getByRole("menuitem", { name: NAMES.chatMenuItem }).or(p.getByRole("button", { name: NAMES.chatMenuItem })).first(),
  chatInput: (p: Page): Locator =>
    p.getByRole("textbox", { name: NAMES.chatInput }).or(p.locator(TID.chatInput)).first(),
  sendButton: (p: Page): Locator =>
    p.getByRole("button", { name: NAMES.sendButton }).or(p.locator(TID.sendButton)).first(),
  peopleButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.peopleButton }).first(),
  leaveButton: (p: Page): Locator =>
    p.getByRole("button", { name: NAMES.leaveButton }).or(p.locator(TID.hangup)).first(),
  leaveConfirm: (p: Page): Locator =>
    p.getByRole("dialog").getByRole("button", { name: NAMES.leaveConfirm }).first(),
  rejoinButton: (p: Page): Locator => p.getByRole("button", { name: NAMES.rejoin }).first(),
  text: (p: Page, re: RegExp): Locator => p.getByText(re).first(),
  /** Every candidate on/off control for a device (buttons, switches, checkboxes). */
  mediaToggles: (p: Page, kind: MediaKind): Locator => {
    const name = MEDIA_NAME[kind];
    return p
      .getByRole("button", { name })
      .or(p.getByRole("switch", { name }))
      .or(p.getByRole("checkbox", { name }));
  },
} as const;

// ---------------------------------------------------------------------------
// Camera / microphone toggles
// ---------------------------------------------------------------------------

export type MediaKind = "camera" | "mic";
export type MediaState = "on" | "off" | "unknown";

export const MEDIA_NAME: Record<MediaKind, RegExp> = {
  camera: /camera|video/i,
  mic: /mic(rophone)?|audio|mute/i,
};

/** Controls that merely open settings / device pickers / effects: never toggle those. */
const MEDIA_SKIP = /settings|device|select|choose|effects|background|blur|more|options|speaker|noise|dropdown|menu/i;

const DEVICE = "(camera|video|mic\\w*|audio)";
/** Action labels: "Turn camera off", "Turn off camera", "Mute mic" => the device is currently ON. */
const ACTION_OFF = new RegExp(`^\\s*(mute|turn off|switch off|stop)\\b|turn\\s+(the\\s+)?${DEVICE}\\s+off`, "i");
/** Action labels: "Turn camera on", "Turn on camera", "Unmute" => the device is currently OFF. */
const ACTION_ON = new RegExp(`^\\s*(unmute|turn on|switch on|start)\\b|turn\\s+(the\\s+)?${DEVICE}\\s+on`, "i");
/** State labels: "Camera on" / "Camera is off" / "Mic muted". */
const STATE_ON = new RegExp(`${DEVICE}\\s+(is\\s+)?on\\b|\\bunmuted\\b`, "i");
const STATE_OFF = new RegExp(`${DEVICE}\\s+(is\\s+)?(off|muted)\\b|\\bmuted\\b`, "i");

/**
 * Decides whether a camera/mic control is currently ON, from its accessible name and `aria-checked`.
 * Action-style labels ("Turn camera off", "Mute mic", "Unmute") win; for plain "Camera"/"Microphone"
 * switches we fall back to aria-checked. `aria-pressed` on buttons is ambiguous (pressed often means
 * "muted"), so it is deliberately ignored. UNVERIFIED against real Teams labels.
 */
export function classifyMediaToggle(label: string, ariaChecked: string | null | undefined): MediaState {
  if (MEDIA_SKIP.test(label)) return "unknown";
  if (ACTION_ON.test(label)) return "off";
  if (ACTION_OFF.test(label)) return "on";
  if (STATE_ON.test(label)) return "on";
  if (STATE_OFF.test(label)) return "off";
  if (ariaChecked === "true") return "on";
  if (ariaChecked === "false") return "off";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Names and counts
// ---------------------------------------------------------------------------

const SUFFIX_WORDS =
  "guest|you|external|unverified|organi[sz]er|presenter|presenting|host|visitor|anonymous|bot|he/him|she/her|they/them";
const TRAILING_SUFFIX = new RegExp(`\\s*\\((?:${SUFFIX_WORDS})\\)\\s*$`, "i");
/** Status words Teams appends to tile / roster aria-labels: "Priya Sharma, Muted", "Tom Lee, speaking, camera on". */
const TRAILING_STATUS = new RegExp(
  `\\s*[,;-]\\s*(?:muted|unmuted|speaking|not speaking|camera (?:on|off)|video (?:on|off)|mic(?:rophone)? (?:on|off)|pinned|spotlighted|presenting|raised hand|hand raised|in the lobby|connecting|reconnecting)\\s*$`,
  "i",
);

/**
 * Normalises a Teams display name: strips status suffixes from aria-labels (", Muted") and role suffixes
 * "(Guest)", "(You)", "(External)", ... then collapses whitespace.
 */
export function cleanParticipantName(raw: string | null | undefined): string {
  let name = (raw ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 8; i++) {
    const next = name.replace(TRAILING_STATUS, "").replace(TRAILING_SUFFIX, "").trim();
    if (next === name) break;
    name = next;
  }
  return name;
}

/** Extracts the participant count from the People button's label / badge, e.g. "People (3)", "Show participants 3". */
export function parseParticipantCount(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /(\d+)/.exec(label);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Participant / active-speaker detection (runs INSIDE the page via page.evaluate)
// ---------------------------------------------------------------------------

export interface ParticipantDomConfig {
  /** One element per participant tile or roster row. UNVERIFIED against real Teams. */
  tileSelector: string;
  /** Where to find the display name inside a tile, in priority order. Falls back to the tile's aria-label. */
  nameSelectors: string[];
  /** Explicit "is speaking" markers (attributes). */
  speakingSelector: string;
  /** Voice-level outline / equaliser elements; speaking while visible and animating. */
  indicatorSelector: string;
}

/** UNVERIFIED against real Teams: every value below is a best guess. Patch here when tiles change. */
export const PARTICIPANT_DOM: ParticipantDomConfig = {
  tileSelector: [
    '[data-tid="calling-participant-stream"]',
    '[data-tid="video-tile"]',
    '[data-cid="calling-participant-stream"]',
    '[data-tid^="participant-item"]',
    '[data-tid="roster-participant"]',
  ].join(", "),
  nameSelectors: ['[data-tid="display-name"]', '[data-tid="participant-name"]', '[data-tid="roster-participant-name"]'],
  speakingSelector: '[data-is-speaking="true"], [data-tid="speaking-indicator"]',
  indicatorSelector: '[data-tid="voice-level-stream-outline"], [data-tid="voice-level-indicator"]',
};

export interface ScannedParticipant {
  /** Raw name text (still carries suffixes); run through `cleanParticipantName`. */
  raw: string;
  speaking: boolean;
}

/**
 * THE active-speaker heuristic (patch me when Teams changes). Must be self-contained: it is serialised into the page.
 * A participant counts as speaking when, within its tile/row, any of these holds:
 *  1. an explicit speaking marker is visible (`data-is-speaking="true"` etc.);
 *  2. a voice-level indicator is visible and has a running CSS animation / non-zero `data-audio-level`;
 *  3. the tile's aria-label says "speaking" (and not "not speaking").
 */
export function scanParticipants(cfg: ParticipantDomConfig): ScannedParticipant[] {
  const out: ScannedParticipant[] = [];
  const seen = new Set<Element>();

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const isAnimating = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (cs.animationName && cs.animationName !== "none" && cs.animationPlayState !== "paused") return true;
    const a = (el as HTMLElement).getAnimations?.() ?? [];
    return a.some((x) => x.playState === "running");
  };

  for (const tile of Array.from(document.querySelectorAll<HTMLElement>(cfg.tileSelector))) {
    if (seen.has(tile)) continue;
    seen.add(tile);

    let raw = "";
    for (const s of cfg.nameSelectors) {
      const el = tile.matches(s) ? tile : tile.querySelector(s);
      const text = el?.textContent?.trim();
      if (text) {
        raw = text;
        break;
      }
    }
    const label = tile.getAttribute("aria-label") ?? "";
    if (!raw) raw = label.trim();
    if (!raw) continue;

    let speaking = false;
    const explicit = tile.matches(cfg.speakingSelector) ? tile : tile.querySelector(cfg.speakingSelector);
    if (explicit && isVisible(explicit)) speaking = true;
    if (!speaking) {
      for (const ind of Array.from(tile.querySelectorAll(cfg.indicatorSelector))) {
        if (!isVisible(ind)) continue;
        const level = ind.getAttribute("data-audio-level");
        if (level !== null && Number(level) > 0) speaking = true;
        else if (isAnimating(ind) || Array.from(ind.querySelectorAll("*")).some(isAnimating)) speaking = true;
        if (speaking) break;
      }
    }
    if (!speaking && /(^|[\s,;])speaking\b/i.test(label) && !/not speaking/i.test(label)) speaking = true;

    out.push({ raw, speaking });
  }
  return out;
}

/** Cleaned, de-duplicated names of everyone currently speaking. */
export function speakingNames(scanned: ScannedParticipant[]): string[] {
  const names: string[] = [];
  for (const p of scanned) {
    if (!p.speaking) continue;
    const n = cleanParticipantName(p.raw);
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

/** Number of distinct participants visible in tiles / roster rows. */
export function distinctParticipantCount(scanned: ScannedParticipant[]): number {
  return new Set(scanned.map((p) => cleanParticipantName(p.raw).toLowerCase()).filter(Boolean)).size;
}
