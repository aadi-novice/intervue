/** Pure helpers for the interviews UI (no React, easy to unit-test). */

export type Platform = "google_meet" | "teams" | "zoom" | "jitsi" | "upload";

export const PLATFORM_LABEL: Record<Platform, string> = {
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  jitsi: "Jitsi",
  upload: "Upload",
};

/** Detect the meeting platform from a pasted URL. Returns null for unknown/invalid links. */
export function detectPlatform(raw: string): Platform | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (host === "meet.google.com") return "google_meet";
  if (is("teams.microsoft.com") || is("teams.live.com")) return "teams";
  if (is("zoom.us") || is("zoomgov.com")) return "zoom";
  if (host === "meet.jit.si") return "jitsi";
  return null;
}

/** Platforms the notetaker bot can join today. */
export function botSupported(platform: string | null | undefined): boolean {
  return platform === "google_meet" || platform === "teams";
}

/** Honest caveat for Microsoft Teams: some tenants block guests (the bot then reports `guests_not_allowed`). */
export const TEAMS_GUEST_HINT =
  "Some organizations block guests from joining Teams meetings; if yours does, the notetaker will report that it was not allowed in and you can upload a transcript or recording instead.";

/** Friendly helper text for the meeting-link field. */
export function platformHint(raw: string): { ok: boolean; text: string } | null {
  if (!raw.trim()) return null;
  const p = detectPlatform(raw);
  if (!p) return { ok: false, text: "We don't recognise this link. Use a Google Meet, Teams or Zoom URL, or leave it empty." };
  if (!botSupported(p))
    return {
      ok: false,
      text: `${PLATFORM_LABEL[p]} detected. The notetaker can't join it yet; upload a transcript or recording after the call instead.`,
    };
  if (p === "teams")
    return { ok: true, text: `${PLATFORM_LABEL[p]} detected. The notetaker can join this meeting. ${TEAMS_GUEST_HINT}` };
  return { ok: true, text: `${PLATFORM_LABEL[p]} detected. The notetaker can join this meeting.` };
}

/** Bot statuses during which we keep polling. */
export const ACTIVE_BOT_STATUSES = ["scheduled", "launching", "joining", "waiting_admission", "in_call", "leaving"] as const;

export function isBotActive(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_BOT_STATUSES as readonly string[]).includes(status);
}

export const FAST_POLL_MS = 3000;
export const SLOW_POLL_MS = 30000;

/**
 * Polling interval for an interview: fast while the bot or the post-call pipeline
 * is working, slow while a call is merely scheduled, off when idle.
 */
export function pollInterval(input: {
  botStatus?: string | null;
  interviewStatus?: string | null;
  analysisStatus?: string | null;
}): number | false {
  const { botStatus, interviewStatus, analysisStatus } = input;
  if (interviewStatus === "processing") return FAST_POLL_MS;
  if (analysisStatus === "queued" || analysisStatus === "running") return FAST_POLL_MS;
  if (botStatus === "processing") return FAST_POLL_MS;
  if (botStatus === "scheduled") return SLOW_POLL_MS;
  if (isBotActive(botStatus)) return FAST_POLL_MS;
  return false;
}

export const FAILURE_MESSAGES: Record<string, string> = {
  admission_timeout: "Nobody admitted the notetaker to the meeting in time. Admit it from the waiting room next time, or send it again.",
  blocked_by_host: "The meeting host removed or blocked the notetaker.",
  guests_not_allowed: "This meeting only allows people from the host's organisation, so the notetaker could not join.",
  meeting_not_found: "The meeting link could not be found. Check that it is correct and the meeting still exists.",
  ui_changed: "The meeting page changed and the notetaker could not join. Upload a transcript or recording instead.",
  crash: "The notetaker crashed during the call. Whatever was captured is being processed.",
  launch_failed: "The notetaker could not start. Please try sending it again.",
  timeout: "The notetaker timed out before the call ended.",
  cancelled: "The notetaker was stopped.",
};

export function failureMessage(reason: string | null | undefined, detail?: string | null): string {
  if (!reason) return detail || "The notetaker failed for an unknown reason.";
  return FAILURE_MESSAGES[reason] ?? detail ?? `The notetaker failed (${reason}).`;
}

/** Deep link from an analysis citation to a transcript segment. */
export function citationHref(interviewId: number | string, segmentId: number | string): string {
  return `/interviews/${interviewId}?tab=transcript&seg=${segmentId}`;
}

export type Citation = { id: number; href: string };

export function buildCitations(interviewId: number | string, segmentIds: readonly number[] | undefined | null): Citation[] {
  return (segmentIds ?? []).map((id) => ({ id, href: citationHref(interviewId, id) }));
}

export type CitedPoint = { text: string; segment_ids: number[] };

/** Legacy analyses store plain strings; newer ones `{text, segment_ids}`. */
export function normalizePoint(p: unknown): CitedPoint {
  if (typeof p === "string") return { text: p, segment_ids: [] };
  if (p && typeof p === "object") {
    const o = p as { text?: unknown; segment_ids?: unknown };
    return {
      text: typeof o.text === "string" ? o.text : "",
      segment_ids: Array.isArray(o.segment_ids) ? o.segment_ids.filter((n): n is number => typeof n === "number") : [],
    };
  }
  return { text: String(p ?? ""), segment_ids: [] };
}

/** Segment id from `?seg=` or `#seg-<id>`. */
export function parseSegmentTarget(search: string, hash = ""): number | null {
  const q = new URLSearchParams(search).get("seg");
  const m = q ?? /^#?seg-(\d+)$/.exec(hash)?.[1] ?? null;
  if (m == null) return null;
  const n = Number(m);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type SpeakerKind = "interviewer" | "candidate" | "unknown";

export interface SpeakerDraft {
  speaker_label: string;
  participant_id: number | null;
  kind: SpeakerKind;
}

export interface SpeakerLike {
  speaker_label: string;
  speaker_kind: string;
  participant_id: number | null;
}

export function draftsFromSpeakers(speakers: readonly SpeakerLike[]): SpeakerDraft[] {
  return speakers.map((s) => ({
    speaker_label: s.speaker_label,
    participant_id: s.participant_id,
    kind: (["interviewer", "candidate"].includes(s.speaker_kind) ? s.speaker_kind : "unknown") as SpeakerKind,
  }));
}

/** Only changed rows are sent to PATCH /speakers. */
export function buildSpeakerPayload(
  original: readonly SpeakerDraft[],
  edited: readonly SpeakerDraft[],
): { mappings: { speaker_label: string; participant_id: number | null; kind: SpeakerKind }[] } {
  const orig = new Map(original.map((o) => [o.speaker_label, o]));
  const mappings = edited
    .filter((e) => {
      const o = orig.get(e.speaker_label);
      return !o || o.participant_id !== e.participant_id || o.kind !== e.kind;
    })
    .map((e) => ({ speaker_label: e.speaker_label, participant_id: e.participant_id, kind: e.kind }));
  return { mappings };
}

export function hasCandidateSpeaker(speakers: readonly SpeakerLike[]): boolean {
  return speakers.some((s) => s.speaker_kind === "candidate");
}

export const ANALYSIS_ERRORS: Record<string, string> = {
  no_resume: "Upload the candidate's resume before running analysis.",
  no_transcript: "This interview has no transcript yet. Upload one, or wait for the notetaker to finish.",
  speakers_unmapped: "Map at least one speaker to the candidate in the Transcript tab before running analysis.",
  job_in_progress: "An analysis is already running for this interview.",
  no_analysis: "No analysis has been run yet.",
};

export function analysisErrorMessage(code: string | undefined, fallback: string): string {
  return (code && ANALYSIS_ERRORS[code]) || fallback;
}

export const UPLOAD_ERRORS: Record<string, string> = {
  unsupported_file: "This file type isn't supported. Use .txt, .vtt, .srt or .docx for transcripts, or an audio/video file.",
  bad_file: "The file couldn't be read. Check that it isn't corrupted.",
  bad_file_size: "The file is empty or too large.",
  upload_missing: "The file didn't reach storage. Please try the upload again.",
};

export function uploadErrorMessage(code: string | undefined, fallback: string): string {
  return (code && UPLOAD_ERRORS[code]) || fallback;
}

export function botErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "bot_active":
      return "A notetaker is already scheduled or in the call.";
    case "platform_unsupported":
      return "The notetaker supports Google Meet and Microsoft Teams, not Zoom yet. Upload a transcript or recording instead.";
    case "no_active_bot":
      return "No notetaker is active for this interview.";
    case "interview_closed":
      return "This interview is already closed.";
    case "bad_schedule":
      return 'Scheduled sends need a start time in the future. Use "Send now" instead.';
    default:
      return fallback;
  }
}

export const TRANSCRIPT_EXTENSIONS = [".txt", ".vtt", ".srt", ".docx"];

export function isTranscriptFile(name: string): boolean {
  const n = name.toLowerCase();
  return TRANSCRIPT_EXTENSIONS.some((e) => n.endsWith(e));
}

/** Refetch a presigned URL a bit before it expires (min 30s). */
export function refetchBeforeExpiryMs(expiresInSeconds: number): number {
  return Math.max(30_000, (expiresInSeconds - 60) * 1000);
}
