import { req } from "./api";

export interface WebhookEndpoint {
  id: number;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  consecutive_failures: number;
  disabled_reason: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

/** Returned by create and rotate-secret only; `secret` is shown exactly once. */
export interface WebhookCreated extends WebhookEndpoint {
  secret: string;
}

export interface WebhookDelivery {
  id: number;
  event: string;
  event_id: string;
  status: "pending" | "success" | "failed" | string;
  attempts: number;
  response_code: number | null;
  error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Returned by create only; `key` is shown exactly once. */
export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export interface SlackStatus {
  configured: boolean;
  /** Last 4 characters of the URL only. */
  hint: string | null;
  events: string[];
  last_error: string | null;
}

const body = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});

export const integrationsApi = {
  webhookEvents: (org: number) => req<{ events: string[] }>(`/orgs/${org}/webhooks/events`),
  webhooks: (org: number) => req<WebhookEndpoint[]>(`/orgs/${org}/webhooks`),
  createWebhook: (org: number, data: { url: string; events: string[]; description: string }) =>
    req<WebhookCreated>(`/orgs/${org}/webhooks`, body("POST", data)),
  updateWebhook: (
    org: number,
    id: number,
    data: Partial<{ url: string; events: string[]; description: string; active: boolean }>,
  ) => req<WebhookEndpoint>(`/orgs/${org}/webhooks/${id}`, body("PATCH", data)),
  rotateSecret: (org: number, id: number) => req<WebhookCreated>(`/orgs/${org}/webhooks/${id}/rotate-secret`, body("POST")),
  deleteWebhook: (org: number, id: number) => req<void>(`/orgs/${org}/webhooks/${id}`, body("DELETE")),
  testWebhook: (org: number, id: number) => req<WebhookDelivery>(`/orgs/${org}/webhooks/${id}/test`, body("POST")),
  deliveries: (org: number, id: number, limit = 50) =>
    req<WebhookDelivery[]>(`/orgs/${org}/webhooks/${id}/deliveries?limit=${limit}`),

  apiKeys: (org: number) => req<ApiKey[]>(`/orgs/${org}/api-keys`),
  createApiKey: (org: number, data: { name: string; expires_in_days?: number }) =>
    req<ApiKeyCreated>(`/orgs/${org}/api-keys`, body("POST", data)),
  revokeApiKey: (org: number, id: number) => req<void>(`/orgs/${org}/api-keys/${id}`, body("DELETE")),

  slack: (org: number) => req<SlackStatus>(`/orgs/${org}/slack`),
  configureSlack: (org: number, data: { webhook_url: string; events: string[] }) =>
    req<SlackStatus>(`/orgs/${org}/slack`, body("PUT", data)),
  removeSlack: (org: number) => req<SlackStatus>(`/orgs/${org}/slack`, body("DELETE")),
  testSlack: (org: number) => req<{ ok: boolean; error: string | null }>(`/orgs/${org}/slack/test`, body("POST")),
};
