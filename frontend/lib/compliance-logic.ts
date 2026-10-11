import { ApiError } from "./api";
import type { IconName } from "@/components/m3/icon";

// ── Notifications ────────────────────────────────────────────────────────────

export interface KindMeta {
  icon: IconName;
  label: string;
}

const KINDS: Record<string, KindMeta> = {
  analysis: { icon: "psychology", label: "Analysis" },
  ranking: { icon: "leaderboard", label: "Ranking" },
  export: { icon: "archive", label: "Export" },
  bot_failed: { icon: "error", label: "Notetaker" },
  transcript_ready: { icon: "subject", label: "Transcript" },
  calendar_reauth: { icon: "event_busy", label: "Calendar" },
};

const GENERIC: KindMeta = { icon: "notifications", label: "Notification" };

export function notificationKindMeta(kind: string): KindMeta {
  return KINDS[kind] ?? GENERIC;
}

/** Only same-app relative links are followed (never an external or protocol-relative URL). */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//") || link.includes("\\")) return null;
  return link;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Retention ────────────────────────────────────────────────────────────────

export const RETENTION_MIN = 1;
export const RETENTION_MAX = 3650;

export function validateRetentionDays(input: string): { value: number | null; error: string | null } {
  const msg = `Enter a whole number from ${RETENTION_MIN} to ${RETENTION_MAX}`;
  const t = input.trim();
  if (!/^\d+$/.test(t)) return { value: null, error: msg };
  const n = Number(t);
  if (n < RETENTION_MIN || n > RETENTION_MAX) return { value: null, error: msg };
  return { value: n, error: null };
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportUi = "none" | "working" | "completed" | "failed" | "expired";

export function exportUiState(status: string | undefined): ExportUi {
  switch (status) {
    case "queued":
    case "running":
      return "working";
    case "completed":
    case "failed":
    case "expired":
      return status;
    default:
      return "none";
  }
}

export function isExportWorking(status: string | undefined): boolean {
  return exportUiState(status) === "working";
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "unknown size";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// ── Erasure ──────────────────────────────────────────────────────────────────

/** The user may type the candidate's name or the word ERASE (case-insensitive, trimmed). */
export function eraseConfirmationMatches(input: string, candidateName: string): boolean {
  const t = input.trim().toLowerCase();
  if (!t) return false;
  return t === "erase" || t === candidateName.trim().toLowerCase();
}

export const ERASE_ITEMS = [
  "Profile and contact details",
  "Resume and avatar files",
  "All interviews",
  "Recordings",
  "Transcripts and speaker data",
  "Analyses and scores",
  "Cached AI text",
  "Calendar copies of their events",
] as const;

// ── Error wording ────────────────────────────────────────────────────────────


export function complianceErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "job_in_progress") return "An export is already in progress. Wait for it to finish.";
    if (err.code === "rate_limited") return "Too many export requests. Please wait a while and try again.";
    if (err.code === "no_candidate_email") return "This candidate has no usable email address.";
    return err.detail;
  }
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
