"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import {
  batchFinished,
  rankingApi,
  type CriterionInput,
  type JobState,
  type RankingFilters,
  type RoleInput,
  type RolePatch,
} from "@/lib/api-ranking";

/** Query keys are prefixed with the current org id so switching orgs refetches. */
export function useOrgId(): number | null {
  return useAuthStore((s) => s.currentOrgId);
}

export const rk = {
  roles: (org: number | null) => ["ranking", org, "roles"] as const,
  role: (org: number | null, id: number) => ["ranking", org, "role", id] as const,
  rubric: (org: number | null, id: number) => ["ranking", org, "role", id, "rubric"] as const,
  suggest: (org: number | null, id: number) => ["ranking", org, "role", id, "suggest"] as const,
  rankings: (org: number | null, id: number, f: RankingFilters) => ["ranking", org, "role", id, "rankings", f] as const,
  rankingsAll: (org: number | null, id: number) => ["ranking", org, "role", id, "rankings"] as const,
  rankStatus: (org: number | null, id: number) => ["ranking", org, "role", id, "rank-status"] as const,
  batch: (org: number | null, id: number | null) => ["ranking", org, "batch", id] as const,
  compare: (org: number | null, id: number, ids: number[]) => ["ranking", org, "compare", id, ids] as const,
  pool: (org: number | null) => ["ranking", org, "pool"] as const,
  matches: (org: number | null, id: string | number) => ["ranking", org, "matches", String(id)] as const,
  card: (org: number | null, id: string | number, role?: number) => ["ranking", org, "card", String(id), role ?? null] as const,
};

const busy = (s: JobState | undefined) => s === "queued" || s === "running";

export function useRoles() {
  const org = useOrgId();
  return useQuery({ queryKey: rk.roles(org), queryFn: rankingApi.roles.list, enabled: org != null });
}

export function useRoleDetail(id: number) {
  const org = useOrgId();
  return useQuery({ queryKey: rk.role(org, id), queryFn: () => rankingApi.roles.get(id), enabled: org != null && id > 0 });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: RoleInput) => rankingApi.roles.create(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ranking"] }),
  });
}

export function useUpdateRole(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: RolePatch) => rankingApi.roles.update(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ranking"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rankingApi.roles.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ranking"] }),
  });
}

export function useRubric(id: number) {
  const org = useOrgId();
  return useQuery({ queryKey: rk.rubric(org, id), queryFn: () => rankingApi.rubric.get(id), enabled: org != null });
}

export function useSaveRubric(id: number) {
  const qc = useQueryClient();
  const org = useOrgId();
  return useMutation({
    mutationFn: (c: CriterionInput[]) => rankingApi.rubric.put(id, c),
    onSuccess: (data) => {
      qc.setQueryData(rk.rubric(org, id), data);
      qc.invalidateQueries({ queryKey: rk.rankingsAll(org, id) });
      qc.invalidateQueries({ queryKey: rk.rankStatus(org, id) });
    },
  });
}

export function useSuggestRubric(id: number) {
  const org = useOrgId();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: rk.suggest(org, id),
    queryFn: () => rankingApi.rubric.suggestStatus(id),
    enabled: org != null,
    refetchInterval: (q) => (busy(q.state.data?.status) ? 1500 : false),
  });
  const start = useMutation({
    mutationFn: () => rankingApi.rubric.suggest(id),
    onSuccess: (d) => qc.setQueryData(rk.suggest(org, id), d),
  });
  return { status, start };
}

export function useRankStatus(id: number) {
  const org = useOrgId();
  return useQuery({
    queryKey: rk.rankStatus(org, id),
    queryFn: () => rankingApi.rank.status(id),
    enabled: org != null,
    refetchInterval: (q) => (busy(q.state.data?.status) ? 1500 : false),
  });
}

export function useStartRank(id: number) {
  const qc = useQueryClient();
  const org = useOrgId();
  return useMutation({
    mutationFn: () => rankingApi.rank.start(id),
    onSuccess: (d) => {
      qc.setQueryData(rk.rankStatus(org, id), d);
      qc.invalidateQueries({ queryKey: rk.rankingsAll(org, id) });
    },
  });
}

export function useRankings(id: number, filters: RankingFilters, polling: boolean) {
  const org = useOrgId();
  return useQuery({
    queryKey: rk.rankings(org, id, filters),
    queryFn: () => rankingApi.rank.rankings(id, filters),
    enabled: org != null,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (polling || busy(q.state.data?.rank_status) ? 2000 : false),
  });
}

export function useBulkUpload(roleId: number) {
  return useMutation({ mutationFn: (files: File[]) => rankingApi.bulk.upload(roleId, files) });
}

export function useBatch(batchId: number | null, roleId: number) {
  const org = useOrgId();
  const qc = useQueryClient();
  return useQuery({
    queryKey: rk.batch(org, batchId),
    queryFn: async () => {
      const b = await rankingApi.bulk.batch(batchId as number);
      if (batchFinished(b.status)) {
        qc.invalidateQueries({ queryKey: rk.rankingsAll(org, roleId) });
        qc.invalidateQueries({ queryKey: rk.pool(org) });
      }
      return b;
    },
    enabled: org != null && batchId != null,
    refetchInterval: (q) => (batchFinished(q.state.data?.status) ? false : 1500),
  });
}

export function useCompare(roleId: number | null, ids: number[]) {
  const org = useOrgId();
  return useQuery({
    queryKey: rk.compare(org, roleId ?? 0, ids),
    queryFn: () => rankingApi.compare(roleId as number, ids),
    enabled: org != null && roleId != null && ids.length >= 2 && ids.length <= 4,
  });
}

export function usePool() {
  const org = useOrgId();
  return useQuery({ queryKey: rk.pool(org), queryFn: rankingApi.candidates.pool, enabled: org != null });
}

export function useMatches(candidateId: string | number) {
  const org = useOrgId();
  return useQuery({
    queryKey: rk.matches(org, candidateId),
    queryFn: () => rankingApi.candidates.matches(candidateId),
    enabled: org != null,
  });
}

export function useSummaryCardData(candidateId: string | number, roleId?: number) {
  const org = useOrgId();
  return useQuery({
    queryKey: rk.card(org, candidateId, roleId),
    queryFn: () => rankingApi.candidates.summaryCard(candidateId, roleId),
    enabled: org != null,
  });
}

export function useReveal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rankingApi.candidates.reveal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ranking"] }),
  });
}
