"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsApi } from "../api-integrations";
import { useAuthStore } from "../auth-store";
import { DELIVERY_POLL_MS, hasPendingDelivery } from "../integrations-logic";

export const intKeys = {
  events: (org: number | null) => ["integrations", org, "webhook-events"] as const,
  webhooks: (org: number | null) => ["integrations", org, "webhooks"] as const,
  deliveries: (org: number | null, id: number) => ["integrations", org, "webhooks", id, "deliveries"] as const,
  apiKeys: (org: number | null) => ["integrations", org, "api-keys"] as const,
  slack: (org: number | null) => ["integrations", org, "slack"] as const,
};

const useOrg = () => useAuthStore((s) => s.currentOrgId);

export function useWebhookEvents(enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: intKeys.events(org),
    queryFn: () => integrationsApi.webhookEvents(org as number),
    select: (d) => d.events,
    enabled: org != null && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useWebhooks() {
  const org = useOrg();
  return useQuery({
    queryKey: intKeys.webhooks(org),
    queryFn: () => integrationsApi.webhooks(org as number),
    enabled: org != null,
  });
}

/** `poll` keeps refetching (e.g. right after "Send test"); it also continues while any delivery is pending. */
export function useDeliveries(id: number | null, poll: boolean) {
  const org = useOrg();
  return useQuery({
    queryKey: intKeys.deliveries(org, id ?? -1),
    queryFn: () => integrationsApi.deliveries(org as number, id as number),
    enabled: org != null && id != null,
    refetchInterval: (q) => (poll || hasPendingDelivery(q.state.data) ? DELIVERY_POLL_MS : false),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useCreateWebhook() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (data: { url: string; events: string[]; description: string }) => integrationsApi.createWebhook(org as number, data),
    onSuccess: () => inv(intKeys.webhooks(org)),
  });
}

export function useUpdateWebhook() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number; data: Partial<{ url: string; events: string[]; description: string; active: boolean }> }) =>
      integrationsApi.updateWebhook(org as number, v.id, v.data),
    onSuccess: () => inv(intKeys.webhooks(org)),
  });
}

export function useRotateSecret() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => integrationsApi.rotateSecret(org as number, id),
    onSuccess: () => inv(intKeys.webhooks(org)),
  });
}

export function useDeleteWebhook() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => integrationsApi.deleteWebhook(org as number, id),
    onSuccess: () => inv(intKeys.webhooks(org)),
  });
}

export function useTestWebhook() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => integrationsApi.testWebhook(org as number, id),
    onSuccess: (_d, id) => inv(intKeys.deliveries(org, id), intKeys.webhooks(org)),
  });
}

export function useApiKeys() {
  const org = useOrg();
  return useQuery({
    queryKey: intKeys.apiKeys(org),
    queryFn: () => integrationsApi.apiKeys(org as number),
    enabled: org != null,
  });
}

export function useCreateApiKey() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (data: { name: string; expires_in_days?: number }) => integrationsApi.createApiKey(org as number, data),
    onSuccess: () => inv(intKeys.apiKeys(org)),
  });
}

export function useRevokeApiKey() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => integrationsApi.revokeApiKey(org as number, id),
    onSuccess: () => inv(intKeys.apiKeys(org)),
  });
}

export function useSlack() {
  const org = useOrg();
  return useQuery({
    queryKey: intKeys.slack(org),
    queryFn: () => integrationsApi.slack(org as number),
    enabled: org != null,
  });
}

export function useConfigureSlack() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (data: { webhook_url: string; events: string[] }) => integrationsApi.configureSlack(org as number, data),
    onSuccess: () => inv(intKeys.slack(org)),
  });
}

export function useRemoveSlack() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => integrationsApi.removeSlack(org as number),
    onSuccess: () => inv(intKeys.slack(org)),
  });
}

export function useTestSlack() {
  const org = useOrg();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => integrationsApi.testSlack(org as number),
    // A failed test records `last_error` server-side.
    onSettled: () => inv(intKeys.slack(org)),
  });
}
