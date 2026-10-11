import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnackbarProvider } from "@/components/m3/snackbar";
import { useAuthStore } from "@/lib/auth-store";
import type { ApiKey, SlackStatus, WebhookEndpoint } from "@/lib/api-integrations";

// Radix Checkbox/Switch measure with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const api = vi.hoisted(() => ({
  webhookEvents: vi.fn(),
  webhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  rotateSecret: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  deliveries: vi.fn(),
  apiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  slack: vi.fn(),
  configureSlack: vi.fn(),
  removeSlack: vi.fn(),
  testSlack: vi.fn(),
}));
vi.mock("@/lib/api-integrations", () => ({ integrationsApi: api }));

import { WebhookCard, WebhookList, WebhooksSection } from "@/components/integrations/webhooks-section";
import { ApiKeysSection } from "@/components/integrations/api-keys-section";
import { SlackSection } from "@/components/integrations/slack-section";
import { IntegrationsAdmin } from "@/components/integrations/integrations-admin";
import { BotControls } from "@/components/interviews/bot-parts";
import { ResumeParseFailedBanner } from "@/components/candidate/resume-parse-failed";
import { isParseFailed, isParsePending } from "@/lib/resume-parse";

const ep = (over: Partial<WebhookEndpoint> = {}): WebhookEndpoint => ({
  id: 1,
  url: "https://hooks.example.com/intervue?token=zzz",
  description: "Prod receiver",
  events: ["*"],
  active: true,
  consecutive_failures: 0,
  disabled_reason: null,
  last_success_at: null,
  last_failure_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const slackStatus = (over: Partial<SlackStatus> = {}): SlackStatus => ({
  configured: false,
  hint: null,
  events: [],
  last_error: null,
  ...over,
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SnackbarProvider>{ui}</SnackbarProvider>
    </QueryClientProvider>,
  );
}

const org = (role: "admin" | "recruiter") => ({ id: 1, name: "Acme", slug: "acme", role, settings: {} });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentOrgId: 1, orgs: [org("admin")] });
  api.webhookEvents.mockResolvedValue({ events: ["interview.completed", "analysis.completed", "ranking.completed"] });
  api.webhooks.mockResolvedValue([]);
  api.deliveries.mockResolvedValue([]);
  api.apiKeys.mockResolvedValue([]);
  api.slack.mockResolvedValue(slackStatus());
});

describe("webhook list states", () => {
  const noop = () => {};
  it("shows a loading region", () => {
    render(<WebhookList endpoints={undefined} loading onRetry={noop} renderCard={() => null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading webhook endpoints/i);
  });
  it("shows the empty state", () => {
    render(<WebhookList endpoints={[]} loading={false} onRetry={noop} renderCard={() => null} />);
    expect(screen.getByText("No webhook endpoints")).toBeInTheDocument();
  });
  it("shows an error with retry", () => {
    const retry = vi.fn();
    render(<WebhookList endpoints={undefined} loading={false} error="Nope" onRetry={retry} renderCard={() => null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
  it("renders host + path (no query), chips and disabled reason", () => {
    const handlers = { onToggle: noop, onEdit: noop, onTest: noop, onHistory: noop, onRotate: noop, onDelete: noop };
    render(
      <WebhookCard
        endpoint={ep({ active: false, disabled_reason: "too many failures", consecutive_failures: 20, events: ["ranking.completed"] })}
        {...handlers}
      />,
    );
    expect(screen.getByText("hooks.example.com")).toBeInTheDocument();
    expect(screen.queryByText(/token=zzz/)).not.toBeInTheDocument();
    expect(screen.getByText("ranking.completed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Disabled: too many failures/);
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /enable endpoint/i })).not.toBeChecked();
  });
});

describe("WebhooksSection", () => {
  it("creates an endpoint with All events, shows the secret once, then clears it", async () => {
    api.createWebhook.mockResolvedValue({ ...ep({ id: 5 }), secret: "whsec_supersecret123" });
    wrap(<WebhooksSection />);
    expect(await screen.findByText("No webhook endpoints")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), { target: { value: "https://hooks.example.com/x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add endpoint" }));

    await waitFor(() =>
      expect(api.createWebhook).toHaveBeenCalledWith(1, { url: "https://hooks.example.com/x", events: ["*"], description: "" }),
    );
    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByTestId("revealed-value")).toHaveTextContent("whsec_supersecret123");
    expect(within(reveal).getByText(/won't see this again|won't see it again/i)).toBeInTheDocument();
    expect(within(reveal).getByText("Python example")).toBeInTheDocument();
    expect(within(reveal).getByText("Node example")).toBeInTheDocument();

    fireEvent.click(within(reveal).getByRole("button", { name: "I've saved it" }));
    await waitFor(() => expect(screen.queryByText(/whsec_supersecret123/)).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends only the chosen events", async () => {
    api.createWebhook.mockResolvedValue({ ...ep({ id: 5 }), secret: "whsec_x" });
    wrap(<WebhooksSection />);
    await screen.findByText("No webhook endpoints");
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), { target: { value: "https://hooks.example.com/x" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "All events" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "ranking.completed" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add endpoint" }));
    await waitFor(() => expect(api.createWebhook).toHaveBeenCalled());
    expect(api.createWebhook.mock.calls[0][1].events).toEqual(["ranking.completed"]);
  });

  it("requires at least one event", async () => {
    wrap(<WebhooksSection />);
    await screen.findByText("No webhook endpoints");
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), { target: { value: "https://hooks.example.com/x" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "All events" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add endpoint" }));
    expect(await within(dialog).findByText(/choose at least one event/i)).toBeInTheDocument();
    expect(api.createWebhook).not.toHaveBeenCalled();
  });

  it("explains unsafe_url errors", async () => {
    api.createWebhook.mockRejectedValue(Object.assign(new Error("x"), { code: "unsafe_url", detail: "blocked", status: 422 }));
    wrap(<WebhooksSection />);
    await screen.findByText("No webhook endpoints");
    fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), { target: { value: "https://10.0.0.1/x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add endpoint" }));
    expect(await within(dialog).findByText(/public https URLs/)).toBeInTheDocument();
  });

  it("lists endpoints and shows the delivery history", async () => {
    api.webhooks.mockResolvedValue([ep()]);
    api.deliveries.mockResolvedValue([
      {
        id: 9, event: "ping", event_id: "evt_1", status: "failed", attempts: 2, response_code: 500, error: "HTTP 500",
        next_attempt_at: null, delivered_at: null, created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    wrap(<WebhooksSection />);
    expect(await screen.findByText("hooks.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delivery history" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("Failed")).toBeInTheDocument();
    expect(within(sheet).getByText(/2 attempts · response 500/)).toBeInTheDocument();
    expect(within(sheet).getByText("HTTP 500")).toBeInTheDocument();
  });

  it("Send test triggers the ping and opens deliveries", async () => {
    api.webhooks.mockResolvedValue([ep()]);
    api.testWebhook.mockResolvedValue({ id: 3, status: "pending" });
    wrap(<WebhooksSection />);
    await screen.findByText("hooks.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(api.testWebhook).toHaveBeenCalledWith(1, 1));
    await waitFor(() => expect(api.deliveries).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Delivery history" })).toBeInTheDocument();
  });

  it("re-enabling sends active: true", async () => {
    api.webhooks.mockResolvedValue([ep({ active: false, disabled_reason: "x" })]);
    api.updateWebhook.mockResolvedValue(ep());
    wrap(<WebhooksSection />);
    fireEvent.click(await screen.findByRole("switch", { name: /enable endpoint/i }));
    await waitFor(() => expect(api.updateWebhook).toHaveBeenCalledWith(1, 1, { active: true }));
  });
});

describe("ApiKeysSection", () => {
  const key = (over: Partial<ApiKey> = {}): ApiKey => ({
    id: 1, name: "CI", prefix: "ik_1a2b3c4d", last_used_at: null, expires_at: null, revoked_at: null, created_at: "2026-01-01T00:00:00Z", ...over,
  });

  it("shows the empty state and a read-only/blind-review note", async () => {
    wrap(<ApiKeysSection />);
    expect(await screen.findByText("No API keys")).toBeInTheDocument();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/blind review/i)).toBeInTheDocument();
  });

  it("reveals the key once with a curl example", async () => {
    api.createApiKey.mockResolvedValue({ ...key({ id: 2, name: "Dash" }), key: "ik_1a2b3c4d_THESECRETPART" });
    wrap(<ApiKeysSection />);
    await screen.findByText("No API keys");
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dash" } });
    fireEvent.change(within(dialog).getByLabelText(/Expires in/), { target: { value: "90" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledWith(1, { name: "Dash", expires_in_days: 90 }));
    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByTestId("revealed-value")).toHaveTextContent("ik_1a2b3c4d_THESECRETPART");
    expect(within(reveal).getByText(/curl .*\/public\/v1\/roles/)).toBeInTheDocument();
    expect(within(reveal).getByText(/won't see it again/i)).toBeInTheDocument();
    fireEvent.click(within(reveal).getByRole("button", { name: "I've saved it" }));
    await waitFor(() => expect(screen.queryByText(/THESECRETPART/)).not.toBeInTheDocument());
  });

  it("rejects an out-of-range expiry client-side", async () => {
    wrap(<ApiKeysSection />);
    await screen.findByText("No API keys");
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.change(within(dialog).getByLabelText(/Expires in/), { target: { value: "9999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(/between 1 and 730/)).toBeInTheDocument();
    expect(api.createApiKey).not.toHaveBeenCalled();
  });

  it("handles too_many_keys", async () => {
    api.createApiKey.mockRejectedValue(Object.assign(new Error("x"), { code: "too_many_keys", detail: "At most 20", status: 409 }));
    wrap(<ApiKeysSection />);
    await screen.findByText("No API keys");
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(/API key limit/)).toBeInTheDocument();
  });

  it("lists keys and revokes after confirming", async () => {
    api.apiKeys.mockResolvedValue([key(), key({ id: 2, name: "Old", revoked_at: "2026-01-02T00:00:00Z" })]);
    api.revokeApiKey.mockResolvedValue(undefined);
    wrap(<ApiKeysSection />);
    expect((await screen.findAllByText("ik_1a2b3c4d…")).length).toBe(2);
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Revoke/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText(/stop working immediately/i)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith(1, 1));
  });
});

describe("SlackSection", () => {
  const SECRET = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX";

  it("rejects non-Slack URLs client-side", async () => {
    wrap(<SlackSection />);
    const input = await screen.findByLabelText("Incoming Webhook URL");
    fireEvent.change(input, { target: { value: "https://example.com/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/must start with https:\/\/hooks\.slack\.com\//)).toBeInTheDocument();
    expect(api.configureSlack).not.toHaveBeenCalled();
  });

  it("never shows the saved URL, clears the input and only shows the last 4 chars", async () => {
    api.configureSlack.mockResolvedValue(slackStatus({ configured: true, hint: "XXXX", events: ["ranking.completed"] }));
    wrap(<SlackSection />);
    const input = (await screen.findByLabelText("Incoming Webhook URL")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET } });
    api.slack.mockResolvedValue(slackStatus({ configured: true, hint: "XXXX", events: ["ranking.completed"] }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.configureSlack).toHaveBeenCalled());
    expect(api.configureSlack.mock.calls[0][1].webhook_url).toBe(SECRET);
    expect(api.configureSlack.mock.calls[0][1].events).toEqual(["interview.completed", "analysis.completed", "ranking.completed", "bot.failed"]);

    expect(await screen.findByText(/Saved webhook ending in …XXXX/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Webhook URL/) as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain("T000/B000");
    expect(screen.getByRole("checkbox", { name: "ranking.completed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "bot.failed" })).not.toBeChecked();
  });

  it("shows server errors", async () => {
    api.configureSlack.mockRejectedValue(Object.assign(new Error("x"), { code: "bad_slack_url", detail: "bad", status: 422 }));
    wrap(<SlackSection />);
    const input = await screen.findByLabelText("Incoming Webhook URL");
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/isn't a Slack Incoming Webhook URL/)).toBeInTheDocument();
  });

  it("shows last_error prominently and test results", async () => {
    api.slack.mockResolvedValue(slackStatus({ configured: true, hint: "abcd", events: [], last_error: "no_service" }));
    api.testSlack.mockResolvedValue({ ok: false, error: "no_service" });
    wrap(<SlackSection />);
    expect(await screen.findByTestId("slack-last-error")).toHaveTextContent("no_service");
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    expect(await screen.findByText(/Test failed: no_service/)).toBeInTheDocument();
  });

  it("removes after confirming", async () => {
    api.slack.mockResolvedValue(slackStatus({ configured: true, hint: "abcd", events: ["bot.failed"] }));
    api.removeSlack.mockResolvedValue(slackStatus());
    wrap(<SlackSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeSlack).toHaveBeenCalledWith(1));
  });
});

describe("IntegrationsAdmin gating", () => {
  it("renders for admins", async () => {
    wrap(<IntegrationsAdmin />);
    expect(await screen.findByRole("heading", { name: "Webhooks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API keys" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slack" })).toBeInTheDocument();
  });
  it("renders nothing for non-admins and makes no requests", () => {
    useAuthStore.setState({ currentOrgId: 1, orgs: [org("recruiter")] });
    const { container } = wrap(<IntegrationsAdmin />);
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(api.webhooks).not.toHaveBeenCalled();
  });
});

describe("notetaker platform support", () => {
  const controls = (platform: string) =>
    wrap(<BotControls interviewId={1} platform={platform} hasUrl botActive={false} hasStart canEdit />);

  it("Teams links offer the notetaker with an honest guest-join hint", () => {
    controls("teams");
    expect(screen.getByRole("button", { name: "Send notetaker now" })).toBeInTheDocument();
    expect(screen.getByText(/block guests/i)).toBeInTheDocument();
  });
  it("Google Meet still offers the notetaker without the Teams hint", () => {
    controls("google_meet");
    expect(screen.getByRole("button", { name: "Send notetaker now" })).toBeInTheDocument();
    expect(screen.queryByText(/block guests/i)).not.toBeInTheDocument();
  });
  it("Zoom falls back to upload", () => {
    controls("zoom");
    expect(screen.queryByRole("button", { name: /Send notetaker/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Upload a transcript or recording/i)).toBeInTheDocument();
  });
});

describe("resume parse failure", () => {
  it("shows the error and a different-file hint", () => {
    render(<ResumeParseFailedBanner error="No extractable text (scanned PDF?)" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No extractable text (scanned PDF?)");
    expect(alert).toHaveTextContent(/text-based PDF or a DOCX/);
  });
  it("only pending polls; failed is terminal", () => {
    expect(isParsePending({ resume_parse_status: "pending" })).toBe(true);
    expect(isParsePending({ resume_parse_status: "failed" })).toBe(false);
    expect(isParseFailed({ resume_parse_status: "failed" })).toBe(true);
    expect(isParseFailed({ resume_parse_status: "ready" })).toBe(false);
  });
});
