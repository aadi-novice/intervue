import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OrgRole = "admin" | "recruiter" | "hiring_manager" | "interviewer";

export interface OrgSettings {
  seed_color?: string;
  blind_review?: boolean;
  data_retention_days?: number;
  bot_name?: string;
  consent_message?: string;
  auto_join?: "all" | "tagged" | "never";
  [key: string]: unknown;
}

export interface OrgSummary {
  id: number;
  name: string;
  slug: string;
  role: OrgRole;
  settings: OrgSettings;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  avatar_url: string | null;
  email_verified: boolean;
}

export interface MeResponse {
  user: AuthUser;
  orgs: OrgSummary[];
}

interface AuthState {
  user: AuthUser | null;
  orgs: OrgSummary[];
  currentOrgId: number | null;
  setSession: (me: MeResponse) => void;
  setCurrentOrg: (id: number) => void;
  clear: () => void;
}

/** UI/session state only; server state lives in TanStack Query (`useMe`). */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      orgs: [],
      currentOrgId: null,
      setSession: (me) => {
        const cur = get().currentOrgId;
        const valid = me.orgs.some((o) => o.id === cur);
        set({ user: me.user, orgs: me.orgs, currentOrgId: valid ? cur : (me.orgs[0]?.id ?? null) });
      },
      setCurrentOrg: (id) => set({ currentOrgId: id }),
      clear: () => set({ user: null, orgs: [], currentOrgId: null }),
    }),
    { name: "intervue-auth", partialize: (s) => ({ user: s.user, orgs: s.orgs, currentOrgId: s.currentOrgId }) },
  ),
);

export function currentOrg(s: Pick<AuthState, "orgs" | "currentOrgId">): OrgSummary | null {
  return s.orgs.find((o) => o.id === s.currentOrgId) ?? null;
}
