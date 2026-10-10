import { useAuthStore, type MeResponse, type OrgRole, type OrgSummary } from "./auth-store";

export type { MeResponse, OrgRole, OrgSummary };

export const API_BASE = "/api";

// ── Errors ───────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
}

/** Backend error envelope: `{ detail, code }` (+ `errors` for 422). */
export class ApiError extends Error {
  status: number;
  code: string;
  detail: string;
  errors?: ValidationIssue[];
  constructor(status: number, code: string, detail: string, errors?: ValidationIssue[]) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
  }
}

// ── Navigation hook (swappable in tests) ─────────────────────────────────────

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/invite"];

export const navigation = {
  toLogin(): void {
    if (typeof window === "undefined") return;
    const { pathname, search } = window.location;
    if (AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    const next = encodeURIComponent(pathname + search);
    window.location.assign(`/login?next=${next}`);
  },
};

// ── Transport ────────────────────────────────────────────────────────────────

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

/** Auth endpoints where a 401 means "bad credentials/token", not "session expired". */
const NO_REFRESH = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
];

/** Endpoints that are not scoped to the current org. */
const NO_ORG = ["/auth/", "/orgs"];

function shouldSendOrg(path: string): boolean {
  return !NO_ORG.some((p) => path.startsWith(p));
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const detail = typeof raw.detail === "string" ? raw.detail : res.statusText || `Request failed (${res.status})`;
  return new ApiError(
    res.status,
    typeof raw.code === "string" ? raw.code : "error",
    detail,
    Array.isArray(raw.errors) ? (raw.errors as ValidationIssue[]) : undefined,
  );
}

function send(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("csrf_token");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const orgId = useAuthStore.getState().currentOrgId;
  if (orgId != null && shouldSendOrg(path)) headers.set("X-Org-Id", String(orgId));
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight session refresh: concurrent 401s share one `POST /auth/refresh`. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await send("/auth/refresh", { method: "POST" });
        if (!res.ok) return false;
        useAuthStore.getState().setSession((await res.json()) as MeResponse);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) {
      res = await send(path, init);
      if (res.status === 401) navigation.toLogin();
    } else {
      useAuthStore.getState().clear();
      navigation.toLogin();
    }
  }
  if (!res.ok) throw await toApiError(res);
  return parse<T>(res);
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// ── Types ────────────────────────────────────────────────────────────────────

export interface Role {
  id: number;
  name: string;
  experience_level: string;
  experience_required_years: number;
  created_at: string;
}

export interface PipelineCandidate {
  id: string;
  name: string;
  role: string;
  score: number;
  avatar: string;
  color: string;
  days: number;
  ai: boolean;
  stage: string;
  email: string;
  phone: string | null;
  role_id: number;
  /** Object key (not a URL). */
  resume_path: string | null;
  transcript_path: string | null;
  /** Short-lived presigned URL; use for `<img src>`. */
  avatar_url: string | null;
}

export interface AnalysisSummary {
  id: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  key_moments: unknown[];
  resume_alignment: unknown[];
  technical_score: number;
  communication_score: number;
  confidence_score: number;
  aggregate_score: number;
  created_at: string;
}

export interface ResumeProfile {
  basics: {
    full_name: string;
    headline: string;
    email: string;
    phone: string;
  };
  summary: string;
  education: {
    institution: string;
    degree: string;
    field_of_study: string;
    start_date: string;
    end_date: string;
  }[];
  experience: {
    company: string;
    designation: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
    description: string;
    technologies: string[];
  }[];
  projects: {
    name: string;
    description: string;
    technologies: string[];
    github: string;
    live_link: string;
  }[];
  skills: {
    programming_languages: string[];
    frameworks: string[];
    databases: string[];
    tools: string[];
  };
  metadata: {
    resume_pages: number;
    total_experience_years: number;
  };
}

export type ResumeParseStatus = "no_resume" | "pending" | "ready";

export interface CandidateDetail extends PipelineCandidate {
  phone: string | null;
  /** Short-lived presigned URL for the stored resume. */
  resume_url: string | null;
  resume_parse_status: ResumeParseStatus;
  resume_profile: ResumeProfile | null;
  analysis: AnalysisDetail | null;
}

export interface KeyMoment {
  moment: string;
  signal: string;
}

export interface AnalysisDetail {
  id: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  key_moments: (KeyMoment | string)[];
  resume_alignment: { claim: string; result: string; severity: "low" | "medium" | "high" }[];
  technical_score: number;
  communication_score: number;
  confidence_score: number;
  aggregate_score: number;
  created_at: string;
}

export type AnalysisJobState = "none" | "queued" | "running" | "completed" | "failed";

export interface AnalysisStatus {
  status: AnalysisJobState;
  job_id: string | null;
  error: string | null;
  analysis_id: number | null;
}

export interface Member {
  user_id: number;
  email: string;
  full_name: string;
  role: OrgRole;
}

export interface OrgSettingsPatch {
  name?: string;
  data_retention_days?: number;
  seed_color?: string;
  blind_review?: boolean;
  bot_name?: string;
  consent_message?: string;
  auto_join?: "all" | "tagged" | "never";
}

// ── API calls ────────────────────────────────────────────────────────────────

function upload(path: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return req<unknown>(path, { method: "POST", body: form });
}

export const api = {
  auth: {
    me: () => req<MeResponse>("/auth/me"),
    register: (body: { email: string; password: string; full_name: string }) =>
      req<MeResponse>("/auth/register", post(body)),
    login: (body: { email: string; password: string }) => req<MeResponse>("/auth/login", post(body)),
    refresh: () => req<MeResponse>("/auth/refresh", { method: "POST" }),
    logout: () => req<void>("/auth/logout", { method: "POST" }),
    verifyEmail: (token: string) => req<unknown>("/auth/verify-email", post({ token })),
    resendVerification: () => req<unknown>("/auth/resend-verification", { method: "POST" }),
    forgotPassword: (email: string) => req<unknown>("/auth/forgot-password", post({ email })),
    resetPassword: (token: string, password: string) =>
      req<void>("/auth/reset-password", post({ token, password })),
    oauthUrl: (provider: "google" | "microsoft") => `${API_BASE}/auth/oauth/${provider}/login`,
  },
  orgs: {
    create: (name: string) => req<OrgSummary>("/orgs", post({ name })),
    mine: () => req<OrgSummary[]>("/orgs/me"),
    members: (orgId: number) => req<Member[]>(`/orgs/${orgId}/members`),
    invite: (orgId: number, body: { email: string; role: OrgRole }) =>
      req<{ id: number; email: string; role: string; expires_at: string }>(`/orgs/${orgId}/invitations`, post(body)),
    removeMember: (orgId: number, userId: number) =>
      req<void>(`/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),
    updateSettings: (orgId: number, body: OrgSettingsPatch) =>
      req<OrgSummary>(`/orgs/${orgId}/settings`, { method: "PATCH", body: JSON.stringify(body) }),
    acceptInvitation: (token: string) => req<OrgSummary>("/orgs/invitations/accept", post({ token })),
  },
  analysis: {
    status: (candidateId: string | number) => req<AnalysisStatus>(`/analysis/candidates/${candidateId}/status`),
  },
  roles: {
    list: () => req<Role[]>("/roles/"),
    create: (body: { name: string; experience_level: string; experience_required_years: number }) =>
      req<Role>("/roles/", { method: "POST", body: JSON.stringify(body) }),
    delete: (id: number) => req<void>(`/roles/${id}`, { method: "DELETE" }),
  },
  candidates: {
    list: () => req<PipelineCandidate[]>("/candidates/"),
    get: (id: string | number) => req<CandidateDetail>(`/candidates/${id}`),
    create: (body: { name: string; email: string; phone?: string; role_id: number }) =>
      req<{ id: number; name: string; email: string; phone: string | null; status: string; role_id: number; created_at: string }>(
        "/candidates/",
        { method: "POST", body: JSON.stringify(body) },
      ),
    updateStatus: (id: string | number, status: string) =>
      req(`/candidates/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    delete: (id: string | number) => req<void>(`/candidates/${id}`, { method: "DELETE" }),
    uploadResume: (id: string | number, file: File) => upload(`/candidates/${id}/resume`, file),
    uploadTranscript: (id: string | number, file: File) => upload(`/candidates/${id}/transcript`, file),
    uploadAvatar: (id: string | number, file: File) => upload(`/candidates/${id}/avatar`, file),
    /** Enqueues analysis (202). Poll `api.analysis.status` for progress. */
    triggerAnalysis: (id: string | number) =>
      req<{ status: "queued"; job_id: string }>(`/analysis/candidates/${id}`, { method: "POST" }),
  },
};
