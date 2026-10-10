import type { Candidate } from "@/lib/pipeline-store";

/** Restrict pipeline candidates by role and name search. */
export function filterPipeline(candidates: Candidate[], f: { roleId?: number | null; search?: string }): Candidate[] {
  const q = (f.search ?? "").trim().toLowerCase();
  return candidates.filter(
    (c) => (f.roleId == null || c.role_id === f.roleId) && (!q || c.name.toLowerCase().includes(q)),
  );
}
