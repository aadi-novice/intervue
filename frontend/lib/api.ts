const BASE = "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

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
  resume_path: string | null;
  transcript_path: string | null;
  avatar_path: string | null;
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

export interface CandidateDetail extends PipelineCandidate {
  phone: string | null;
  resume_profile: ResumeProfile | null;
  analysis: AnalysisDetail | null;
}

export interface AnalysisDetail {
  id: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  key_moments: string[];
  resume_alignment: { claim: string; result: string; severity: "low" | "medium" | "high" }[];
  technical_score: number;
  communication_score: number;
  confidence_score: number;
  aggregate_score: number;
  created_at: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

export const api = {
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
        { method: "POST", body: JSON.stringify(body) }
      ),
    updateStatus: (id: string | number, status: string) =>
      req(`/candidates/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    delete: (id: string | number) =>
      req<void>(`/candidates/${id}`, { method: "DELETE" }),
    uploadResume: (id: string | number, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/candidates/${id}/resume`, { method: "POST", body: form }).then((r) =>
        r.json()
      );
    },
    uploadTranscript: (id: string | number, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/candidates/${id}/transcript`, { method: "POST", body: form }).then((r) =>
        r.json()
      );
    },
    uploadAvatar: (id: string | number, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/candidates/${id}/avatar`, { method: "POST", body: form }).then((r) =>
        r.json()
      );
    },
    triggerAnalysis: (id: string | number) =>
      req<{
        id: number;
        summary: string;
        strengths: unknown[];
        weaknesses: unknown[];
        technical_score: number;
        communication_score: number;
        confidence_score: number;
        key_moments: unknown[];
        resume_alignment: unknown[];
        candidate_id: number;
        created_at: string;
      }>(`/analysis/candidates/${id}`, { method: "POST" }),
  },
};
