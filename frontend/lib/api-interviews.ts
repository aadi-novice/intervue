import { ApiError, req } from "./api";
import type { Platform, SpeakerKind } from "./interviews-logic";

// ── Types (mirror backend/app/schemas/{interview,analysis,dashboard}.py) ─────

export interface ParticipantIn {
  display_name: string;
  email?: string | null;
  user_id?: number | null;
  kind?: "interviewer" | "candidate" | "other";
}

export interface InterviewCreate {
  candidate_id: number;
  role_id?: number | null;
  title: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  meeting_url?: string | null;
  platform?: Platform | null;
  participants?: ParticipantIn[];
}

export interface Participant {
  id: number;
  user_id: number | null;
  display_name: string;
  email: string | null;
  kind: string;
}

export interface BotSession {
  id: number;
  status: string;
  failure_reason: string | null;
  failure_detail: string | null;
  joined_at: string | null;
  left_at: string | null;
  consent_message_sent_at: string | null;
}

export interface InterviewNotes {
  summary: string;
  key_points: unknown[];
  topics: unknown[];
  follow_ups: unknown[];
}

export interface InterviewSummary {
  id: number;
  candidate_id: number;
  candidate_name: string;
  role_id: number | null;
  role_name: string | null;
  title: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  meeting_url: string | null;
  platform: Platform | string;
  status: string;
  bot_status: string | null;
  created_at: string;
}

export interface SpeakerSummary {
  speaker_label: string;
  speaker_kind: string;
  participant_id: number | null;
  segment_count: number;
}

export type AnalysisJobStatus = "none" | "queued" | "running" | "completed" | "failed";

export interface InterviewDetail extends InterviewSummary {
  participants: Participant[];
  bot_session: BotSession | null;
  notes: InterviewNotes | null;
  segment_count: number;
  has_recording: boolean;
  analysis_status: AnalysisJobStatus;
  analysis_id: number | null;
  speakers: SpeakerSummary[];
}

export interface Segment {
  id: number;
  speaker_label: string;
  speaker_kind: SpeakerKind;
  participant_id: number | null;
  start_ms: number;
  end_ms: number;
  text: string;
  position: number;
}

export interface SegmentPage {
  items: Segment[];
  total: number;
  offset: number;
  limit: number;
}

export interface RecordingUrl {
  url: string;
  expires_in: number;
  mime_type: string;
  duration_ms: number | null;
}

export interface CitedPointRaw {
  text: string;
  segment_ids: number[];
}

export interface InterviewKeyMoment {
  moment: string;
  signal: string;
  segment_id?: number;
  timestamp_ms?: number;
}

export interface ClaimCheck {
  claim: string;
  resume_quote?: string;
  verdict?: "verified" | "unclear" | "contradicted";
  result: string;
  severity?: "low" | "medium" | "high";
  segment_ids?: number[];
}

export interface InterviewAnalysis {
  id: number;
  summary: string;
  strengths: (CitedPointRaw | string)[];
  weaknesses: (CitedPointRaw | string)[];
  technical_score: number;
  communication_score: number;
  confidence_score: number;
  key_moments: (InterviewKeyMoment | string)[];
  resume_alignment: ClaimCheck[];
  candidate_id: number;
  interview_id: number | null;
  hiring_recommendation: string | null;
  created_at: string;
}

export interface InterviewAnalysisStatus {
  status: AnalysisJobStatus;
  job_id: number | null;
  error: string | null;
  analysis_id: number | null;
}

export interface SpeakerMappingBody {
  mappings: { speaker_label: string; participant_id?: number | null; kind?: SpeakerKind | null }[];
}

export interface RecordingUploadStart {
  upload_url: string;
  key: string;
  headers: Record<string, string>;
  max_bytes: number;
}

export interface DashboardCandidate {
  id: number;
  name: string;
  email: string | null;
  avatar_url: string | null;
  avatar: string;
  stage: string;
  blind: boolean;
  role_id: number;
}

export interface DashboardSummary {
  roles: {
    id: number;
    name: string;
    candidate_count: number;
    scored_count: number;
    avg_score: number | null;
    rank_status: string;
  }[];
  upcoming_interviews: InterviewSummary[];
  recent_analyses: {
    analysis_id: number;
    interview_id: number | null;
    candidate: DashboardCandidate;
    role_name: string | null;
    aggregate: number;
    recommendation: string | null;
    created_at: string;
  }[];
  ai_cost_month_usd: number | null;
}

export interface UsageOut {
  month: string;
  total_usd: number;
  by_purpose: { purpose: string; runs: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
}

export interface ActivityItem {
  id: number;
  action: string;
  user_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface InterviewFilters {
  from?: string;
  to?: string;
  role_id?: number | null;
  candidate_id?: number | null;
}

// ── Calls ────────────────────────────────────────────────────────────────────

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const interviewsApi = {
  list: (f: InterviewFilters = {}) =>
    req<InterviewSummary[]>(
      `/interviews${qs({ from: f.from, to: f.to, role_id: f.role_id, candidate_id: f.candidate_id })}`,
    ),
  get: (id: number | string) => req<InterviewDetail>(`/interviews/${id}`),
  create: (body: InterviewCreate) => req<InterviewDetail>("/interviews", json("POST", body)),
  cancel: (id: number | string) => req<InterviewSummary>(`/interviews/${id}/cancel`, json("POST")),
  transcript: (id: number | string, offset = 0, limit = 500) =>
    req<SegmentPage>(`/interviews/${id}/transcript${qs({ offset, limit })}`),
  mapSpeakers: (id: number | string, body: SpeakerMappingBody) =>
    req<InterviewDetail>(`/interviews/${id}/speakers`, json("PATCH", body)),
  recording: (id: number | string) => req<RecordingUrl>(`/interviews/${id}/recording`),
  sendBot: (id: number | string, mode: "now" | "scheduled" = "now") =>
    req<BotSession>(`/interviews/${id}/bot`, json("POST", { mode })),
  stopBot: (id: number | string) => req<BotSession>(`/interviews/${id}/bot`, json("DELETE")),
  requestAnalysis: (id: number | string) =>
    req<InterviewAnalysisStatus>(`/interviews/${id}/analysis`, json("POST")),
  analysisStatus: (id: number | string) => req<InterviewAnalysisStatus>(`/interviews/${id}/analysis/status`),
  analysis: (id: number | string) => req<InterviewAnalysis>(`/interviews/${id}/analysis`),

  /** Transcript file upload: .txt/.vtt/.srt/.docx. `req` adds CSRF + X-Org-Id and leaves the multipart boundary to the browser. */
  uploadTranscript: (id: number | string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<unknown>(`/interviews/${id}/upload`, { method: "POST", body: form });
  },

  startRecordingUpload: (id: number | string, contentType: string) =>
    req<RecordingUploadStart>(`/interviews/${id}/recording-upload`, json("POST", { content_type: contentType })),
  completeRecordingUpload: (id: number | string, key: string) =>
    req<{ status: string; recording_id: number }>(`/interviews/${id}/recording-upload/complete`, json("POST", { key })),
};

export const dashboardApi = {
  summary: () => req<DashboardSummary>("/dashboard/summary"),
  usage: (orgId: number) => req<UsageOut>(`/orgs/${orgId}/usage`),
  activity: (candidateId: number | string) => req<ActivityItem[]>(`/candidates/${candidateId}/activity`),
};

// ── Presigned PUT upload (browser -> object store) ───────────────────────────

export interface XhrLike {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  withCredentials: boolean;
}

/**
 * PUT a file to a presigned URL. Sends ONLY the headers the API returned: no cookies
 * (`withCredentials=false`), no CSRF token, no org header.
 */
export function putToPresignedUrl(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
  makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = makeXhr();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else reject(new ApiError(xhr.status, "upload_failed", `Upload to storage failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "upload_failed", "Network error while uploading"));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export function recordingContentType(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

/** Full flow: presign -> PUT to storage (progress) -> complete. */
export async function uploadRecording(
  interviewId: number | string,
  file: File,
  opts: { onProgress?: (fraction: number) => void; makeXhr?: () => XhrLike; signal?: AbortSignal } = {},
): Promise<void> {
  const start = await interviewsApi.startRecordingUpload(interviewId, recordingContentType(file));
  if (file.size > start.max_bytes) {
    throw new ApiError(422, "file_too_large", `File is larger than the ${Math.round(start.max_bytes / 1_000_000)} MB limit`);
  }
  await putToPresignedUrl(start.upload_url, file, start.headers, opts.onProgress, opts.makeXhr, opts.signal);
  await interviewsApi.completeRecordingUpload(interviewId, start.key);
}
