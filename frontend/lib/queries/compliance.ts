"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { complianceApi } from "../api-compliance";
import { isExportWorking } from "../compliance-logic";
import { useAuthStore } from "../auth-store";

export const compKeys = {
  notifications: (org: number | null) => ["notifications", org, "list"] as const,
  unread: (org: number | null) => ["notifications", org, "unread"] as const,
  exportLatest: (org: number | null) => ["compliance", org, "export-latest"] as const,
};

const useOrg = () => useAuthStore((s) => s.currentOrgId);

const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Polls every 30 s while the tab is visible; refetches on window focus. */
export function useUnreadCount() {
  const org = useOrg();
  return useQuery({
    queryKey: compKeys.unread(org),
    queryFn: complianceApi.unreadCount,
    enabled: org != null,
    select: (d) => d.count,
    refetchInterval: () => (pageHidden() ? false : 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useNotifications(enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: compKeys.notifications(org),
    queryFn: () => complianceApi.notifications(30),
    enabled: org != null && enabled,
    refetchOnWindowFocus: true,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["notifications"] });
}

export function useMarkRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: (id: number) => complianceApi.markRead(id), onSettled: invalidate });
}

export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: complianceApi.markAllRead, onSettled: invalidate });
}

export function useLatestExport(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: compKeys.exportLatest(orgId),
    queryFn: () => complianceApi.latestExport(orgId as number),
    enabled: orgId != null && enabled,
    refetchInterval: (q) => (isExportWorking(q.state.data?.status) ? 3000 : false),
  });
}

export function useRequestExport(orgId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (includeRecordings: boolean) => complianceApi.requestExport(orgId, includeRecordings),
    onSuccess: (data) => qc.setQueryData(compKeys.exportLatest(orgId), data),
    onError: () => qc.invalidateQueries({ queryKey: compKeys.exportLatest(orgId) }),
  });
}

export function useEraseCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => complianceApi.eraseCandidate(id),
    // Mark everything stale without refetching the (now missing) candidate's active queries.
    onSuccess: () => qc.invalidateQueries({ refetchType: "none" }),
  });
}

export function useNotifyCandidate() {
  return useMutation({ mutationFn: (interviewId: number | string) => complianceApi.notifyCandidate(interviewId) });
}
