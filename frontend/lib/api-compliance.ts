import { req } from "./api";
import "./api-interviews";

declare module "./api-interviews" {
  interface InterviewSummary {
    /** Recordings and transcript were removed by the retention policy. */
    transcript_purged?: boolean;
  }
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface ExportStatus {
  status: "none" | "queued" | "running" | "completed" | "failed" | "expired";
  error?: string | null;
  size_bytes?: number | null;
  files?: number | null;
  include_recordings?: boolean | null;
  expires_at?: string | null;
  url?: string | null;
}

export interface EraseReceipt {
  candidate_id: number;
  erased_at: string;
  files_deleted: number;
  interviews: number;
  recordings: number;
  analyses: number;
}

export const complianceApi = {
  notifications: (limit = 30) => req<AppNotification[]>(`/notifications?limit=${limit}`),
  unreadCount: () => req<{ count: number }>("/notifications/unread-count"),
  markRead: (id: number) => req<void>(`/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => req<{ updated: number }>("/notifications/read-all", { method: "POST" }),

  requestExport: (orgId: number, includeRecordings: boolean) =>
    req<ExportStatus>(`/orgs/${orgId}/exports`, {
      method: "POST",
      body: JSON.stringify({ include_recordings: includeRecordings }),
    }),
  latestExport: (orgId: number) => req<ExportStatus>(`/orgs/${orgId}/exports/latest`),
  exportDownload: (orgId: number) => req<ExportStatus>(`/orgs/${orgId}/exports/latest?download=true`),

  eraseCandidate: (id: number | string) =>
    req<EraseReceipt>(`/candidates/${id}/erase`, { method: "POST", body: JSON.stringify({ confirm: true }) }),
  notifyCandidate: (interviewId: number | string) =>
    req<{ sent_to: string }>(`/interviews/${interviewId}/notify-candidate`, { method: "POST" }),
};
