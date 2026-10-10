import { ApiError, API_BASE, readCookie, req, refreshSession } from "./api";
import { useAuthStore } from "./auth-store";
import type { PipelineCandidate } from "./api";

// ── Types (mirror backend/app/schemas/{cards,role,candidate}.py) ─────────────

export type JobState = "none" | "queued" | "running" | "completed" | "failed";
export type RoleStatus = "open" | "paused" | "closed";
export type StageName = "applied" | "screening" | "interview" | "offer" | "hired";
export type Verdict = "verified" | "unclear" | "contradicted";

export interface RoleFull {
  id: number;
  name: string;
  experience_level: string;
  experience_required_years: number;
  description: string | null;
  status: RoleStatus;
  created_at: string;
}

export interface RoleInput {
  name: string;
  experience_level: string;
  experience_required_years: number;
  description?: string | null;
}

export interface RolePatch extends Partial<RoleInput> {
  status?: RoleStatus;
}

export interface CandidateMini {
  id: number;
  name: string;
  email: string | null;
  avatar_url: string | null;
  avatar: string;
  stage: string;
  blind: boolean;
  role_id: number;
}

export interface CriterionResult {
  criterion_id: number;
  name: string;
  weight: number;
  must_have: boolean;
  /** 0-5 */
  score: number;
  evidence: string[];
  reasoning: string;
}

export interface ResumeFit {
  status: string;
  overall_score: number | null;
  vector_similarity: number | null;
  must_have_failed: boolean;
  explanation: string | null;
  criteria: CriterionResult[];
  stale: boolean;
}

export interface InterviewFit {
  count: number;
  technical_score: number;
  communication_score: number;
  confidence_score: number;
  aggregate: number;
  latest_analysis_id: number;
  recommendation: string | null;
}

export interface ClaimFlag {
  claim: string;
  verdict: Verdict;
  severity: string;
  segment_ids: number[];
  interview_id: number | null;
}

export interface ClaimChecks {
  verified: number;
  unclear: number;
  contradicted: number;
  flags: ClaimFlag[];
}

export type SuggestionLabel = "Strong yes" | "Yes" | "Lean no" | "No";

export interface Suggestion {
  label: SuggestionLabel | null;
  basis: "interview" | "resume" | "none";
  caption: string;
}

export interface SummaryCardData {
  candidate: CandidateMini;
  role_id: number;
  resume_fit: ResumeFit | null;
  interview: InterviewFit | null;
  claim_checks: ClaimChecks;
  notes_excerpt: string | null;
  suggestion: Suggestion;
}

export interface RankingPageData {
  items: SummaryCardData[];
  total: number;
  offset: number;
  limit: number;
  scored_count: number;
  rank_status: JobState;
  rank_error: string | null;
  rank_progress: Record<string, unknown> | null;
  cost_usd: number | null;
}

export interface RankStatus {
  status: JobState;
  job_id: number | null;
  error: string | null;
  progress: Record<string, unknown> | null;
}

export interface MatchOut {
  role_id: number;
  role_name: string;
  is_primary: boolean;
  status: string;
  overall_score: number | null;
  vector_similarity: number | null;
  must_have_failed: boolean;
  strong: boolean;
}

export interface CompareCell {
  candidate_id: number;
  value: number | null;
  evidence: string[];
}

export interface CompareRow {
  key: string;
  label: string;
  kind: "resume" | "criterion" | "interview" | "claims";
  cells: CompareCell[];
  best_candidate_ids: number[];
}

export interface CompareMatrix {
  role_id: number;
  candidates: CandidateMini[];
  rows: CompareRow[];
  suggestions: Record<string, Suggestion>;
}

export interface Criterion {
  id: number;
  name: string;
  description: string;
  weight: number;
  must_have: boolean;
  position: number;
}

export interface CriterionInput {
  id?: number;
  name: string;
  description: string;
  weight: number;
  must_have: boolean;
}

export interface RubricData {
  criteria: Criterion[];
  rubric_hash: string;
}

export interface RubricSuggestStatus {
  status: JobState;
  error: string | null;
  criteria: Partial<CriterionInput>[] | null;
}

export interface BatchIssue {
  file?: string;
  status?: string;
  detail?: string;
}

export interface Batch {
  id: number;
  role_id: number;
  total: number;
  processed: number;
  failed: number;
  status: string;
  errors: BatchIssue[];
  created_at: string | null;
}

export interface BestMatch {
  role_id: number;
  role_name: string;
  score: number | null;
  similarity: number | null;
}

export interface PoolCandidate extends PipelineCandidate {
  source: string | null;
  interviewed: boolean;
  best_match: BestMatch | null;
}

export interface RankingFilters {
  mustHavesMet?: boolean;
  minScore?: number;
  maxScore?: number;
  stage?: StageName | "";
  interviewed?: boolean;
  offset?: number;
  limit?: number;
}

/** Filters -> query string (omits defaults so the URL stays short). */
export function rankingQuery(f: RankingFilters): string {
  const p = new URLSearchParams();
  if (f.mustHavesMet) p.set("must_haves_met", "true");
  if (f.minScore != null && f.minScore > 0) p.set("min_score", String(f.minScore));
  if (f.maxScore != null && f.maxScore < 100) p.set("max_score", String(f.maxScore));
  if (f.stage) p.set("stage", f.stage);
  if (f.interviewed) p.set("interviewed", "true");
  if (f.offset) p.set("offset", String(f.offset));
  p.set("limit", String(f.limit ?? 200));
  return `?${p.toString()}`;
}

export function batchFinished(status: string | undefined): boolean {
  return status === "completed" || status === "failed";
}

// ── Bulk upload client-side validation ───────────────────────────────────────

export const BULK_MAX_FILES = 500;
export const BULK_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const BULK_MAX_ZIP_BYTES = 300 * 1024 * 1024;
const OK_EXT = [".pdf", ".docx", ".zip"];

export interface FileCheck {
  accepted: File[];
  rejected: { name: string; reason: string }[];
}

export function validateResumeFiles(files: File[], alreadyQueued = 0): FileCheck {
  const accepted: File[] = [];
  const rejected: FileCheck["rejected"] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    const ext = OK_EXT.find((e) => lower.endsWith(e));
    if (!ext) rejected.push({ name: f.name, reason: "Only PDF, DOCX or ZIP files are supported" });
    else if (f.size === 0) rejected.push({ name: f.name, reason: "File is empty" });
    else if (ext === ".zip" ? f.size > BULK_MAX_ZIP_BYTES : f.size > BULK_MAX_FILE_BYTES)
      rejected.push({ name: f.name, reason: ext === ".zip" ? "ZIP is larger than 300 MB" : "File is larger than 10 MB" });
    else if (alreadyQueued + accepted.length >= BULK_MAX_FILES)
      rejected.push({ name: f.name, reason: `At most ${BULK_MAX_FILES} files per upload` });
    else accepted.push(f);
  }
  return { accepted, rejected };
}

// ── Rubric validation / normalisation ────────────────────────────────────────

export const MAX_CRITERIA = 12;

/** Normalised weights as percentages (sum 100); all-zero yields zeros. */
export function normalisedWeights(items: { weight: number }[]): number[] {
  const total = items.reduce((a, c) => a + Math.max(0, c.weight), 0);
  if (total <= 0) return items.map(() => 0);
  return items.map((c) => (Math.max(0, c.weight) / total) * 100);
}

/** Mirrors backend `rubric_service` checks. Returns a map code -> message. */
export function validateRubric(items: Pick<CriterionInput, "name" | "weight">[]): Record<string, string> {
  const errs: Record<string, string> = {};
  if (items.length === 0) errs.rubric_empty = "A rubric needs at least one criterion";
  if (items.length > MAX_CRITERIA) errs.rubric_too_large = `At most ${MAX_CRITERIA} criteria`;
  const names = items.map((i) => i.name.trim().toLowerCase());
  if (names.some((n) => !n) || new Set(names).size !== names.length)
    errs.rubric_names = "Criterion names must be non-empty and unique";
  if (!items.some((i) => i.weight > 0)) errs.rubric_weights = "At least one criterion needs a positive weight";
  return errs;
}

export const RUBRIC_ERROR_MESSAGES: Record<string, string> = {
  rubric_empty: "A rubric needs at least one criterion.",
  rubric_too_large: `A rubric can have at most ${MAX_CRITERIA} criteria.`,
  rubric_names: "Criterion names must be non-empty and unique.",
  rubric_weights: "At least one criterion needs a positive weight.",
  rubric_unknown_id: "A criterion no longer exists. Reload the rubric and try again.",
  no_description: "Add a job description in Settings first.",
};

export function apiMessage(e: unknown): string {
  if (e instanceof ApiError) return RUBRIC_ERROR_MESSAGES[e.code] ?? e.detail;
  return e instanceof Error ? e.message : "Something went wrong";
}

// ── Multipart upload (mirrors lib/api.ts header handling) ────────────────────

async function sendForm(path: string, form: FormData): Promise<Response> {
  const doSend = () => {
    const headers = new Headers();
    const csrf = readCookie("csrf_token");
    if (csrf) headers.set("X-CSRF-Token", csrf);
    const orgId = useAuthStore.getState().currentOrgId;
    if (orgId != null) headers.set("X-Org-Id", String(orgId));
    // No Content-Type: the browser sets the multipart boundary.
    return fetch(`${API_BASE}${path}`, { method: "POST", body: form, headers, credentials: "include" });
  };
  let res = await doSend();
  if (res.status === 401 && (await refreshSession())) res = await doSend();
  return res;
}

async function uploadBulk(roleId: number, files: File[]): Promise<{ batch_id: number }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await sendForm(`/roles/${roleId}/resumes/bulk`, form);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown; code?: string } | null;
    throw new ApiError(
      res.status,
      body?.code ?? "error",
      typeof body?.detail === "string" ? body.detail : res.statusText || "Upload failed",
    );
  }
  return (await res.json()) as { batch_id: number };
}

// ── Calls ────────────────────────────────────────────────────────────────────

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const rankingApi = {
  roles: {
    list: () => req<RoleFull[]>("/roles/"),
    get: (id: number) => req<RoleFull>(`/roles/${id}`),
    create: (body: RoleInput) => req<RoleFull>("/roles/", json("POST", body)),
    update: (id: number, body: RolePatch) => req<RoleFull>(`/roles/${id}`, json("PATCH", body)),
    remove: (id: number) => req<void>(`/roles/${id}`, json("DELETE")),
  },
  rubric: {
    get: (roleId: number) => req<RubricData>(`/roles/${roleId}/rubric`),
    put: (roleId: number, criteria: CriterionInput[]) =>
      req<RubricData>(`/roles/${roleId}/rubric`, json("PUT", { criteria })),
    suggest: (roleId: number) => req<RubricSuggestStatus>(`/roles/${roleId}/rubric/suggest`, json("POST")),
    suggestStatus: (roleId: number) => req<RubricSuggestStatus>(`/roles/${roleId}/rubric/suggest/status`),
  },
  bulk: {
    upload: uploadBulk,
    batch: (id: number) => req<Batch>(`/batches/${id}`),
  },
  rank: {
    start: (roleId: number) => req<RankStatus>(`/roles/${roleId}/rank`, json("POST")),
    status: (roleId: number) => req<RankStatus>(`/roles/${roleId}/rank/status`),
    rankings: (roleId: number, f: RankingFilters) => req<RankingPageData>(`/roles/${roleId}/rankings${rankingQuery(f)}`),
  },
  compare: (roleId: number, ids: number[]) => req<CompareMatrix>(`/roles/${roleId}/compare?candidate_ids=${ids.join(",")}`),
  candidates: {
    pool: () => req<PoolCandidate[]>("/candidates/"),
    matches: (id: number | string) => req<MatchOut[]>(`/candidates/${id}/matches`),
    summaryCard: (id: number | string, roleId?: number) =>
      req<SummaryCardData>(`/candidates/${id}/summary-card${roleId != null ? `?role_id=${roleId}` : ""}`),
    reveal: (id: number | string) => req<void>(`/candidates/${id}/reveal`, json("POST")),
  },
};
