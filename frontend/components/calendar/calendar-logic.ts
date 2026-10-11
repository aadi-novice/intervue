/** Pure helpers for the calendar auto-join UI (no React). */
import type { AutoJoin, CalendarEvent } from "@/lib/api-calendar";

export const PROVIDER_LABEL: Record<string, string> = { google: "Google Calendar", microsoft: "Outlook" };

export const AUTO_JOIN_OPTIONS: { value: AutoJoin; label: string; short: string; description: string }[] = [
  { value: "all", short: "All", label: "Auto-join every interview with a known candidate", description: "The notetaker is sent to every meeting that includes a candidate in your pipeline." },
  { value: "tagged", short: "Tagged", label: "Only meetings I tag", description: "The notetaker only joins meetings you tag for it below." },
  { value: "never", short: "Never", label: "Never send the notetaker (still create interviews)", description: "Interviews are still created from your calendar, but the notetaker is never scheduled." },
];

export function autoJoinLabel(v: AutoJoin): string {
  return AUTO_JOIN_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

const SKIP_MESSAGES: Record<string, string> = {
  no_candidate_match: "No known candidate in the attendees. Pick one to tag it.",
  not_tagged: "Auto-join is set to tagged only.",
  auto_join_off: "Auto-join is turned off for this calendar.",
  platform_unsupported: "Zoom links aren't supported by the notetaker yet (it joins Google Meet and Microsoft Teams).",
  role_cannot_schedule_bot: "Only admins, recruiters and hiring managers can have the notetaker scheduled automatically.",
  event_in_past: "This meeting has already happened.",
  bot_already_attempted: "The notetaker already tried this meeting; send it manually from the interview page.",
};

export function humanize(code: string): string {
  const s = code.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

export function skipReasonMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return SKIP_MESSAGES[code] ?? humanize(code);
}

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Access was denied, so the calendar was not connected.",
  cancelled: "Connecting was cancelled before it finished.",
  bad_state: "The connection request expired or was invalid. Please try again.",
  wrong_org: "That connection was started in a different organization. Switch organization and try again.",
  no_refresh_token: "Google didn't grant offline access: reconnect and accept all permissions.",
  oauth_denied: "The provider refused the sign-in. Please try again.",
  oauth_failed: "Could not complete the connection with the provider. Please try again.",
  no_account_email: "The provider did not share an account email, so the calendar could not be connected.",
};

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? `Could not connect the calendar (${humanize(code)}).`;
}

export type OAuthResult = { kind: "connected" } | { kind: "error"; code: string } | null;

export function readOAuthResult(params: URLSearchParams): OAuthResult {
  const err = params.get("calendar_error");
  if (err) return { kind: "error", code: err };
  if (params.get("calendar") === "connected") return { kind: "connected" };
  return null;
}

/** Returns the URL (path + query) with the OAuth result params removed; other params stay. */
export function cleanOAuthParams(pathname: string, search: string): string {
  const p = new URLSearchParams(search);
  p.delete("calendar");
  p.delete("calendar_error");
  const q = p.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export function formatEventTime(start: string, end: string | null, locale?: string): string {
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return start;
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(s);
  const t = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const e = end ? new Date(end) : null;
  return e && !Number.isNaN(e.getTime()) ? `${day}, ${t.format(s)} to ${t.format(e)}` : `${day}, ${t.format(s)}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function groupEventsByDay(events: CalendarEvent[]): { key: string; label: string; events: CalendarEvent[] }[] {
  const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of sorted) {
    const k = dayKey(e.start);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()].map(([key, evs]) => ({
    key,
    label: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(evs[0].start)),
    events: evs,
  }));
}

/** Poll window after "Sync now". */
export const SYNC_POLL_MS = 15_000;
