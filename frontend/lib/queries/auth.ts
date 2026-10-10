"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OrgSettingsPatch } from "@/lib/api";
import { useAuthStore, type MeResponse, type OrgRole } from "@/lib/auth-store";

export const authKeys = {
  me: ["auth", "me"] as const,
  members: (orgId: number | null) => ["orgs", orgId, "members"] as const,
};

/** Current session. Syncs the Zustand session store as a side effect of fetching. */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      const me = await api.auth.me();
      useAuthStore.getState().setSession(me);
      return me;
    },
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    staleTime: 60_000,
  });
}

function useSessionSetter() {
  const qc = useQueryClient();
  return (me: MeResponse) => {
    useAuthStore.getState().setSession(me);
    qc.setQueryData(authKeys.me, me);
  };
}

export function useLogin() {
  const setSession = useSessionSetter();
  return useMutation({ mutationFn: api.auth.login, onSuccess: setSession });
}

export function useRegister() {
  const setSession = useSessionSetter();
  return useMutation({ mutationFn: api.auth.register, onSuccess: setSession });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => {
      useAuthStore.getState().clear();
      qc.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: api.auth.forgotPassword });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) => api.auth.resetPassword(token, password),
  });
}

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.auth.verifyEmail,
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.me }),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: api.auth.resendVerification });
}

function useAdoptOrg() {
  const qc = useQueryClient();
  return async (orgId: number) => {
    const me = await api.auth.me();
    useAuthStore.getState().setSession(me);
    useAuthStore.getState().setCurrentOrg(orgId);
    qc.setQueryData(authKeys.me, me);
  };
}

export function useCreateOrg() {
  const adopt = useAdoptOrg();
  return useMutation({ mutationFn: api.orgs.create, onSuccess: (org) => adopt(org.id) });
}

export function useAcceptInvitation() {
  const adopt = useAdoptOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.orgs.acceptInvitation,
    onSuccess: async (org) => {
      await adopt(org.id);
      await qc.invalidateQueries();
    },
  });
}

/** Switch org: update the store and invalidate every cached server response. */
export function useSwitchOrg() {
  const qc = useQueryClient();
  return (orgId: number) => {
    useAuthStore.getState().setCurrentOrg(orgId);
    void qc.invalidateQueries();
  };
}

export function useMembers(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: authKeys.members(orgId),
    queryFn: () => api.orgs.members(orgId as number),
    enabled: enabled && orgId != null,
  });
}

export function useInviteMember(orgId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: OrgRole }) => api.orgs.invite(orgId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.members(orgId) }),
  });
}

export function useRemoveMember(orgId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => api.orgs.removeMember(orgId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.members(orgId) }),
  });
}

export function useUpdateOrgSettings(orgId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrgSettingsPatch) => api.orgs.updateSettings(orgId, body),
    onSuccess: async () => {
      const me = await api.auth.me();
      useAuthStore.getState().setSession(me);
      qc.setQueryData(authKeys.me, me);
    },
  });
}

/** Human-readable message for any thrown error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "rate_limited") return "Too many attempts. Please wait a moment and try again.";
    if (err.code === "invalid_credentials") return "Incorrect email or password.";
    if (err.code === "email_taken") return "An account with this email already exists.";
    if (err.code === "weak_password") return "That password is too weak. Use 10+ characters with letters and digits.";
    if (err.code === "oauth_not_configured") return "This sign-in provider is not configured for this deployment yet.";
    if (err.code === "last_admin") return "You cannot remove the last admin of an organization.";
    if (err.code === "validation_error" && err.errors?.length) return err.errors.map((e) => e.msg).join(". ");
    return err.detail;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
