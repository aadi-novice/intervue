import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnackbarProvider } from "@/components/m3/snackbar";
import { useAuthStore } from "@/lib/auth-store";
import type { AppNotification, ExportStatus } from "@/lib/api-compliance";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const api = vi.hoisted(() => ({
  notifications: vi.fn(),
  unreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock("@/lib/api-compliance", () => ({ complianceApi: api }));

import { NotificationBell } from "@/components/notifications/notification-bell";
import { ExportCardView } from "@/components/compliance/export-card";
import { EraseConfirmDialog } from "@/components/compliance/erase-candidate-dialog";
import { PurgedBanner, TranscriptPurgedContext, PURGED_MESSAGE } from "@/components/compliance/purged";
import { CitationChips } from "@/components/interviews/analysis-panel";

const note = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 1, kind: "analysis", title: "Analysis ready", body: "Ada Lovelace", link: "/interviews/7?tab=analysis",
  read: false, created_at: new Date().toISOString(), ...over,
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SnackbarProvider>{ui}</SnackbarProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentOrgId: 1 });
  api.markRead.mockResolvedValue(undefined);
  api.markAllRead.mockResolvedValue({ updated: 2 });
});

describe("NotificationBell", () => {
  it("shows the unread badge and an accessible name", async () => {
    api.unreadCount.mockResolvedValue({ count: 3 });
    api.notifications.mockResolvedValue([note()]);
    wrap(<NotificationBell />);
    expect(await screen.findByTestId("unread-badge")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("hides the badge at zero and shows the empty state", async () => {
    api.unreadCount.mockResolvedValue({ count: 0 });
    api.notifications.mockResolvedValue([]);
    wrap(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("marks a notification read and navigates to its link", async () => {
    api.unreadCount.mockResolvedValue({ count: 1 });
    api.notifications.mockResolvedValue([note()]);
    wrap(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications, 1 unread/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Analysis ready/ }));
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/interviews/7?tab=analysis"));
  });

  it("does not navigate to an external link", async () => {
    api.unreadCount.mockResolvedValue({ count: 1 });
    api.notifications.mockResolvedValue([note({ link: "https://evil.example" })]);
    wrap(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications, 1 unread/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Analysis ready/ }));
    await waitFor(() => expect(api.markRead).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("mark all read calls the endpoint", async () => {
    api.unreadCount.mockResolvedValue({ count: 2 });
    api.notifications.mockResolvedValue([note(), note({ id: 2, title: "Export ready", kind: "export" })]);
    wrap(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications, 2 unread/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(api.markAllRead).toHaveBeenCalled());
  });
});

describe("ExportCardView", () => {
  const base = {
    includeRecordings: false, onIncludeChange: vi.fn(), onRequest: vi.fn(), onDownload: vi.fn(), canRequest: true,
  };
  const view = (status: ExportStatus | undefined, extra = {}) =>
    render(<ExportCardView {...base} status={status} {...extra} />);

  it("none: offers a request with a recordings switch", () => {
    const onRequest = vi.fn();
    view({ status: "none" }, { onRequest });
    expect(screen.getByTestId("export-none")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Include recordings/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request export" }));
    expect(onRequest).toHaveBeenCalled();
  });
  it.each(["queued", "running"] as const)("%s: shows progress and no request button", (s) => {
    view({ status: s });
    expect(screen.getByTestId("export-working")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request/ })).toBeNull();
  });
  it("completed: shows size, files, expiry and downloads", () => {
    const onDownload = vi.fn();
    view({ status: "completed", size_bytes: 2 * 1024 * 1024, files: 12, expires_at: "2030-01-01T00:00:00Z" }, { onDownload });
    expect(screen.getByText(/2\.0 MB · 12 files/)).toBeInTheDocument();
    expect(screen.getByText(/Available until/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalled();
  });
  it("failed: shows the error and a retry", () => {
    view({ status: "failed", error: "storage unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("storage unavailable");
    expect(screen.getByRole("button", { name: "Retry export" })).toBeInTheDocument();
  });
  it("expired: asks for a new export", () => {
    view({ status: "expired" });
    expect(screen.getByText(/has expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a new export" })).toBeInTheDocument();
  });
  it("non-admin cannot request", () => {
    view({ status: "none" }, { canRequest: false });
    expect(screen.queryByRole("button", { name: "Request export" })).toBeNull();
  });
  it("always lists what is excluded", () => {
    view({ status: "none" });
    expect(screen.getByText(/password hashes/)).toBeInTheDocument();
  });
});

describe("EraseConfirmDialog", () => {
  it("keeps the button disabled until the name or ERASE is typed", () => {
    const onConfirm = vi.fn();
    render(
      <EraseConfirmDialog open onOpenChange={() => {}} candidateName="Ada Lovelace" onConfirm={onConfirm} />,
    );
    const btn = screen.getByRole("button", { name: "Erase all data" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("Recordings")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Ada" } });
    expect(btn).toBeDisabled();
    fireEvent.change(input, { target: { value: "ERASE" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ada lovelace" } });
    expect(btn).toBeEnabled();
  });
});

describe("purged state", () => {
  it("renders the banner text", () => {
    render(<PurgedBanner />);
    expect(screen.getByTestId("purged-banner")).toHaveTextContent(PURGED_MESSAGE);
  });
  it("citations are links normally and disabled (no links) when purged", () => {
    const { rerender } = render(<CitationChips interviewId={5} segmentIds={[1, 2]} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    rerender(
      <TranscriptPurgedContext.Provider value>
        <CitationChips interviewId={5} segmentIds={[1, 2]} />
      </TranscriptPurgedContext.Provider>,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByTestId("citation-disabled")).toHaveLength(2);
  });
});
