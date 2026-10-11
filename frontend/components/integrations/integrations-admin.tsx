"use client";

import { Divider } from "@/components/m3";
import { currentOrg, useAuthStore } from "@/lib/auth-store";
import { CAN, roleAllowed } from "@/lib/roles";
import { ApiKeysSection } from "./api-keys-section";
import { SlackSection } from "./slack-section";
import { WebhooksSection } from "./webhooks-section";

/** Webhooks, API keys and Slack. Admin-only: renders nothing for other roles (the backend enforces it too). */
export function IntegrationsAdmin() {
  const isAdmin = useAuthStore((s) => roleAllowed(currentOrg(s)?.role ?? null, CAN.admin));
  if (!isAdmin) return null;
  return (
    <div className="mt-10 max-w-3xl space-y-10">
      <Divider />
      <WebhooksSection />
      <Divider />
      <ApiKeysSection />
      <Divider />
      <SlackSection />
    </div>
  );
}
