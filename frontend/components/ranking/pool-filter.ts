import type { PoolCandidate } from "@/lib/api-ranking";

export interface PoolFilters {
  search: string;
  roleId: number | null;
  stage: string; // "all" or stage id
  minScore: number;
  source: string; // "all" or source name
  interviewedOnly: boolean;
}

export const DEFAULT_POOL_FILTERS: PoolFilters = {
  search: "",
  roleId: null,
  stage: "all",
  minScore: 0,
  source: "all",
  interviewedOnly: false,
};

export function filterPool(list: PoolCandidate[], f: PoolFilters): PoolCandidate[] {
  const q = f.search.trim().toLowerCase();
  return list.filter(
    (c) =>
      (!q ||
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        (c.best_match?.role_name ?? "").toLowerCase().includes(q)) &&
      (f.roleId == null || c.role_id === f.roleId) &&
      (f.stage === "all" || c.stage === f.stage) &&
      c.score >= f.minScore &&
      (f.source === "all" || (c.source ?? "manual") === f.source) &&
      (!f.interviewedOnly || c.interviewed),
  );
}
