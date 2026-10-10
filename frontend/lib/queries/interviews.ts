"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import {
  dashboardApi,
  interviewsApi,
  type InterviewCreate,
  type InterviewFilters,
  type SpeakerMappingBody,
} from "../api-interviews";
import { useAuthStore } from "../auth-store";
import { pollInterval, refetchBeforeExpiryMs } from "../interviews-logic";

/** Query keys always include the org id so switching orgs never shows stale data. */
export function useOrgId(): number | null {
  return useAuthStore((s) => s.currentOrgId);
}

export const ivKeys = {
  list: (org: number | null, f: InterviewFilters) => ["interviews", org, "list", f] as const,
  all: (org: number | null) => ["interviews", org] as const,
  detail: (org: number | null, id: string | number) => ["interviews", org, "detail", String(id)] as const,
  transcript: (org: number | null, id: string | number) => ["interviews", org, "transcript", String(id)] as const,
  recording: (org: number | null, id: string | number) => ["interviews", org, "recording", String(id)] as const,
  analysis: (org: number | null, id: string | number) => ["interviews", org, "analysis", String(id)] as const,
  analysisStatus: (org: number | null, id: string | number) =>
    ["interviews", org, "analysis-status", String(id)] as const,
  dashboard: (org: number | null) => ["dashboard", org] as const,
  usage: (org: number | null) => ["usage", org] as const,
  activity: (org: number | null, id: string | number) => ["activity", org, String(id)] as const,
  roles: (org: number | null) => ["iv-roles", org] as const,
  candidates: (org: number | null) => ["iv-candidates", org] as const,
};

export function useInterviews(filters: InterviewFilters, enabled = true) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.list(org, filters),
    queryFn: () => interviewsApi.list(filters),
    enabled: enabled && org != null,
    // Bot chips on list rows move; refresh gently.
    refetchInterval: 30_000,
  });
}

export function useInterview(id: string | number) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.detail(org, id),
    queryFn: () => interviewsApi.get(id),
    enabled: org != null && !!id,
    refetchInterval: (q) =>
      pollInterval({
        botStatus: q.state.data?.bot_session?.status ?? q.state.data?.bot_status,
        interviewStatus: q.state.data?.status,
        analysisStatus: q.state.data?.analysis_status,
      }),
  });
}

const PAGE = 1000;

/** Transcript is paged with offset/limit (max 1000); all pages are loaded progressively. */
export function useTranscript(id: string | number, enabled: boolean, refetchWhileProcessing = false) {
  const org = useOrgId();
  return useInfiniteQuery({
    queryKey: ivKeys.transcript(org, id),
    queryFn: ({ pageParam }) => interviewsApi.transcript(id, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total && last.items.length > 0 ? next : undefined;
    },
    enabled: enabled && org != null && !!id,
    refetchInterval: refetchWhileProcessing ? 5000 : false,
  });
}

/** Presigned recording URL; refetched shortly before it expires. 404 `no_recording` => no player. */
export function useRecording(id: string | number, enabled: boolean) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.recording(org, id),
    queryFn: () => interviewsApi.recording(id),
    enabled: enabled && org != null && !!id,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    staleTime: (q) => (q.state.data ? refetchBeforeExpiryMs(q.state.data.expires_in) : 0),
    refetchInterval: (q) => (q.state.data ? refetchBeforeExpiryMs(q.state.data.expires_in) : false),
    refetchIntervalInBackground: false,
  });
}

export function useAnalysisStatus(id: string | number, enabled = true) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.analysisStatus(org, id),
    queryFn: () => interviewsApi.analysisStatus(id),
    enabled: enabled && org != null && !!id,
    refetchInterval: (q) => (q.state.data?.status === "queued" || q.state.data?.status === "running" ? 2000 : false),
  });
}

export function useInterviewAnalysis(id: string | number | null | undefined, enabled = true) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.analysis(org, id ?? "none"),
    queryFn: () => interviewsApi.analysis(id as number),
    enabled: enabled && org != null && id != null,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}

function useInvalidateInterview(id?: string | number) {
  const qc = useQueryClient();
  const org = useOrgId();
  return () => {
    if (id != null) void qc.invalidateQueries({ queryKey: ivKeys.detail(org, id) });
    void qc.invalidateQueries({ queryKey: ["interviews", org, "list"] });
    void qc.invalidateQueries({ queryKey: ivKeys.dashboard(org) });
  };
}

export function useCreateInterview() {
  const invalidate = useInvalidateInterview();
  return useMutation({
    mutationFn: (body: InterviewCreate) => interviewsApi.create(body),
    onSuccess: invalidate,
  });
}

export function useSendBot(id: string | number) {
  const invalidate = useInvalidateInterview(id);
  return useMutation({
    mutationFn: (mode: "now" | "scheduled") => interviewsApi.sendBot(id, mode),
    onSuccess: invalidate,
  });
}

/** For lists: the interview id is the mutation variable. */
export function useSendBotFor() {
  const invalidate = useInvalidateInterview();
  return useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: "now" | "scheduled" }) => interviewsApi.sendBot(id, mode),
    onSuccess: invalidate,
  });
}

export function useStopBot(id: string | number) {
  const invalidate = useInvalidateInterview(id);
  return useMutation({ mutationFn: () => interviewsApi.stopBot(id), onSuccess: invalidate });
}

export function useMapSpeakers(id: string | number) {
  const qc = useQueryClient();
  const org = useOrgId();
  return useMutation({
    mutationFn: (body: SpeakerMappingBody) => interviewsApi.mapSpeakers(id, body),
    onSuccess: (detail) => {
      qc.setQueryData(ivKeys.detail(org, id), detail);
      void qc.invalidateQueries({ queryKey: ivKeys.transcript(org, id) });
    },
  });
}

export function useRequestAnalysis(id: string | number) {
  const qc = useQueryClient();
  const org = useOrgId();
  return useMutation({
    mutationFn: () => interviewsApi.requestAnalysis(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ivKeys.analysisStatus(org, id) });
      void qc.invalidateQueries({ queryKey: ivKeys.detail(org, id) });
    },
  });
}

export function useDashboardSummary() {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.dashboard(org),
    queryFn: () => dashboardApi.summary(),
    enabled: org != null,
    refetchInterval: 60_000,
  });
}

export function useOrgUsage(enabled: boolean) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.usage(org),
    queryFn: () => dashboardApi.usage(org as number),
    enabled: enabled && org != null,
  });
}

export function useCandidateActivity(id: string | number, enabled: boolean) {
  const org = useOrgId();
  return useQuery({
    queryKey: ivKeys.activity(org, id),
    queryFn: () => dashboardApi.activity(id),
    enabled: enabled && org != null && !!id,
    retry: false,
  });
}

export function useRoleOptions() {
  const org = useOrgId();
  return useQuery({ queryKey: ivKeys.roles(org), queryFn: () => api.roles.list(), enabled: org != null });
}

export function useCandidateOptions() {
  const org = useOrgId();
  return useQuery({ queryKey: ivKeys.candidates(org), queryFn: () => api.candidates.list(), enabled: org != null });
}
