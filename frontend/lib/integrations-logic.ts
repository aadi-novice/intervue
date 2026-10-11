/** Pure helpers for the Integrations settings UI (no React, easy to unit-test). */

export const ALL_EVENTS = "*";
export const SLACK_EVENTS = ["interview.completed", "analysis.completed", "ranking.completed", "bot.failed"] as const;
export const SLACK_URL_PREFIX = "https://hooks.slack.com/";
export const MAX_KEY_DAYS = 730;
export const DELIVERY_POLL_MS = 1500;

// ── Webhook events → payload ─────────────────────────────────────────────────

/** "All events" sends `["*"]`; otherwise the chosen events in catalogue order. `null` = nothing chosen. */
export function eventsPayload(all: boolean, selected: readonly string[], catalogue: readonly string[]): string[] | null {
  if (all) return [ALL_EVENTS];
  const chosen = catalogue.filter((e) => selected.includes(e));
  return chosen.length ? chosen : null;
}

/** Reverse of `eventsPayload`, for the edit dialog. */
export function eventsSelection(events: readonly string[]): { all: boolean; selected: string[] } {
  return events.includes(ALL_EVENTS) ? { all: true, selected: [] } : { all: false, selected: [...events] };
}

export function eventsLabel(events: readonly string[]): string[] {
  return events.includes(ALL_EVENTS) ? ["All events"] : [...events];
}

// ── URL validation ───────────────────────────────────────────────────────────

export const UNSAFE_URL_MESSAGE =
  "Endpoints must be public https URLs. Private, localhost and internal addresses (and URLs containing credentials) are blocked.";

function isPrivateIp(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

/** Blocking client check: only obviously malformed input. Safety rules are enforced (and configurable) server-side. */
export function webhookUrlShapeError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the endpoint URL.";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "The URL must start with https://.";
  } catch {
    return "Enter a full URL such as https://example.com/hooks/intervue.";
  }
  return null;
}

/** Advisory pre-check for a webhook URL (shown as a hint, never blocks); the server is the authority and also resolves DNS. */
export function webhookUrlError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the endpoint URL.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL such as https://example.com/hooks/intervue.";
  }
  if (url.protocol !== "https:") return "The URL must start with https://.";
  if (url.username || url.password) return "The URL must not contain a username or password.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return UNSAFE_URL_MESSAGE;
  }
  if (isPrivateIp(host)) return UNSAFE_URL_MESSAGE;
  return null;
}

/** Host + path for the list (query strings can carry tokens, so they are not shown). */
export function displayUrl(raw: string): { host: string; path: string } {
  try {
    const u = new URL(raw);
    return { host: u.host, path: u.pathname === "/" ? "" : u.pathname };
  } catch {
    return { host: raw, path: "" };
  }
}

// ── Error code → message ─────────────────────────────────────────────────────

interface ErrLike {
  code?: string;
  detail?: string;
  message?: string;
}

const fallback = (e: unknown, def = "Something went wrong") => {
  const x = (e ?? {}) as ErrLike;
  return x.detail || x.message || def;
};

export function webhookErrorMessage(e: unknown): string {
  switch ((e as ErrLike)?.code) {
    case "unsafe_url":
      return UNSAFE_URL_MESSAGE;
    case "unknown_event":
      return `One of the selected events isn't supported. ${fallback(e, "")}`.trim();
    case "unresolvable_host":
      return "We couldn't resolve that host name. Check the URL spelling and that the endpoint is publicly reachable.";
    case "too_many_endpoints":
      return "This organization has reached its endpoint limit (10). Delete an unused endpoint first.";
    default:
      return fallback(e);
  }
}

export function apiKeyErrorMessage(e: unknown): string {
  if ((e as ErrLike)?.code === "too_many_keys") return "This organization has reached its API key limit. Revoke an unused key first.";
  return fallback(e);
}

export function slackErrorMessage(e: unknown): string {
  switch ((e as ErrLike)?.code) {
    case "bad_slack_url":
      return "That isn't a Slack Incoming Webhook URL. Use the one from Slack (https://hooks.slack.com/services/...).";
    case "unsafe_url":
      return "Slack webhook URLs must be https://hooks.slack.com/ addresses.";
    case "unknown_event":
      return `One of the selected events isn't supported. ${fallback(e, "")}`.trim();
    default:
      return fallback(e);
  }
}

// ── Slack ────────────────────────────────────────────────────────────────────

/** Client pre-validation of the pasted Incoming Webhook URL. */
export function slackUrlError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Paste the Incoming Webhook URL from Slack.";
  if (!v.startsWith(SLACK_URL_PREFIX)) return `The URL must start with ${SLACK_URL_PREFIX}`;
  if (v.length <= SLACK_URL_PREFIX.length + 8) return "That URL looks incomplete. Copy the whole Incoming Webhook URL from Slack.";
  return null;
}

export function slackHint(hint: string | null | undefined): string {
  // The backend may already prefix the hint with an ellipsis.
  const tail = hint?.replace(/^[….]+/, "");
  return tail ? `Saved webhook ending in …${tail}` : "A webhook is saved";
}

// ── API keys ─────────────────────────────────────────────────────────────────

/** Parses the optional expiry field. Empty = no expiry (`undefined`); otherwise an integer 1-730. */
export function parseExpiryDays(raw: string): { ok: true; days: number | undefined } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: true, days: undefined };
  if (!/^\d+$/.test(v)) return { ok: false, error: `Enter a whole number of days between 1 and ${MAX_KEY_DAYS}.` };
  const n = Number(v);
  if (n < 1 || n > MAX_KEY_DAYS) return { ok: false, error: `Expiry must be between 1 and ${MAX_KEY_DAYS} days.` };
  return { ok: true, days: n };
}

/** `ik_1a2b3c4d…`; the prefix from the API may or may not already include `ik_`. */
export function keyPrefixLabel(prefix: string): string {
  return `${prefix.startsWith("ik_") ? prefix : `ik_${prefix}`}…`;
}

export type KeyState = "active" | "revoked" | "expired";

export function keyState(k: { revoked_at: string | null; expires_at: string | null }, now = Date.now()): KeyState {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && Date.parse(k.expires_at) <= now) return "expired";
  return "active";
}

/** Example request for the one-time reveal dialog. */
export function curlExample(key: string, origin = "https://api.example.com"): string {
  return `curl ${origin.replace(/\/$/, "")}/public/v1/roles \\\n  -H "Authorization: Bearer ${key}"`;
}

// ── One-time secrets ─────────────────────────────────────────────────────────

/** What a one-time reveal holds; cleared when the dialog closes. */
export type Reveal =
  | { kind: "webhook"; id: number; secret: string; rotated: boolean }
  | { kind: "apikey"; id: number; name: string; key: string };

export function revealTitle(r: Reveal): string {
  if (r.kind === "apikey") return "Your new API key";
  return r.rotated ? "Your new signing secret" : "Your signing secret";
}

export function revealWarning(kind: Reveal["kind"]): string {
  return kind === "apikey"
    ? "Copy this key now. You won't see it again. If you lose it, revoke it and create a new one."
    : "Copy this secret now. You won't see it again. If you lose it, rotate the secret to get a new one.";
}

export const VERIFY_PYTHON = `import hashlib, hmac, time

def verify(secret: str, header: str, body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    ts = int(parts["t"])
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`;

export const VERIFY_NODE = `import crypto from "node:crypto";

export function verify(secret, header, rawBody, tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > tolerance) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\`).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

// ── Deliveries ───────────────────────────────────────────────────────────────

export type DeliveryTone = "pending" | "success" | "failed";

export function deliveryTone(status: string): DeliveryTone {
  return status === "success" ? "success" : status === "failed" ? "failed" : "pending";
}

export function hasPendingDelivery(d: readonly { status: string }[] | undefined): boolean {
  return !!d?.some((x) => deliveryTone(x.status) === "pending");
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function disabledReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Disabled";
  const r = reason.replace(/[_-]+/g, " ").trim();
  return `Disabled: ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
}
