import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SnackbarProvider } from "@/components/m3/snackbar";
import { ConnectionCard } from "@/components/calendar/connection-card";
import { ProviderButtons } from "@/components/calendar/provider-buttons";
import { TagDialog } from "@/components/calendar/tag-dialog";
import type { CalendarConnection, CalendarEvent } from "@/lib/api-calendar";

const conn = (over: Partial<CalendarConnection> = {}): CalendarConnection => ({
  id: 1, provider: "google", account_email: "me@example.com", auto_join: "tagged", status: "active",
  last_synced_at: null, last_error: null, push_enabled: false, ...over,
});

const handlers = { onAutoJoinChange: vi.fn(), onReconnect: vi.fn(), onSync: vi.fn(), onDisconnect: vi.fn() };

describe("ConnectionCard", () => {
  it("active: shows connected, no reconnect", () => {
    render(<ConnectionCard connection={conn()} {...handlers} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByText("Only meetings I tag")).toBeInTheDocument();
    expect(screen.getByText("Not synced yet")).toBeInTheDocument();
  });
  it("needs_reauth: prominent reconnect", () => {
    const onReconnect = vi.fn();
    render(<ConnectionCard connection={conn({ status: "needs_reauth" })} {...handlers} onReconnect={onReconnect} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("error: shows last_error", () => {
    render(<ConnectionCard connection={conn({ status: "error", last_error: "Quota exceeded" })} {...handlers} />);
    expect(screen.getByText("Quota exceeded")).toBeInTheDocument();
  });
});

describe("ProviderButtons", () => {
  it("disables and explains an unconfigured provider", () => {
    const onConnect = vi.fn();
    render(
      <ProviderButtons
        connecting={null}
        onConnect={onConnect}
        providers={[{ provider: "google", configured: true }, { provider: "microsoft", configured: false }]}
      />,
    );
    const ms = screen.getByRole("button", { name: /Outlook/ });
    expect(ms).toBeDisabled();
    expect(screen.getByText(/ask an admin/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Google Calendar/ }));
    expect(onConnect).toHaveBeenCalledWith("google");
  });
});

describe("TagDialog", () => {
  const event = {
    id: 5, connection_id: 1, title: "Interview", start: "2030-01-01T10:00:00Z", end: null, meeting_url: null,
    platform: null, attendees: [], candidate: null, tagged: false, interview_id: null, bot_status: null, skip_reason: "no_candidate_match",
  } as CalendarEvent;
  it("requires a candidate before confirming", () => {
    const onConfirm = vi.fn();
    render(
      <SnackbarProvider>
        <TagDialog event={event} candidates={[{ id: 1, name: "Ada" }]} onConfirm={onConfirm} onClose={() => {}} />
      </SnackbarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tag meeting" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Choose which candidate this meeting is with.")).toBeInTheDocument();
  });
});
