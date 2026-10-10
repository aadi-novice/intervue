import { currentOrg, useAuthStore, type OrgRole } from "./auth-store";

export type { OrgRole };

export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  interviewer: "Interviewer",
};

export const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as OrgRole[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

/** Capability matrix used to hide UI (the backend is the enforcement point). */
export const CAN = {
  /** Create roles/candidates, upload files, run analysis. */
  create: ["admin", "recruiter"],
  /** Move candidates between pipeline stages. */
  moveStage: ["admin", "recruiter", "hiring_manager"],
  /** Org settings and member mutations. */
  admin: ["admin"],
  viewMembers: ["admin", "recruiter", "hiring_manager"],
} as const satisfies Record<string, readonly OrgRole[]>;

export function roleAllowed(role: OrgRole | null, roles: readonly OrgRole[]): boolean {
  return role != null && roles.includes(role);
}

/** The signed-in user role in the current organisation. */
export function useRole(): OrgRole | null {
  return useAuthStore((s) => currentOrg(s)?.role ?? null);
}
