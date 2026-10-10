import { req } from "./api";

export type CalendarProvider = "google" | "microsoft";
export type AutoJoin = "all" | "tagged" | "never";
export type ConnectionStatus = "active" | "needs_reauth" | "error";

export interface ProviderInfo {
  provider: CalendarProvider;
  configured: boolean;
}

export interface CalendarConnection {
  id: number;
  provider: string;
  account_email: string;
  auto_join: AutoJoin;
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  push_enabled: boolean;
}

export interface CalendarEvent {
  id: number;
  connection_id: number;
  title: string;
  start: string;
  end: string | null;
  meeting_url: string | null;
  platform: string | null;
  attendees: Record<string, unknown>[];
  candidate: { id: number; name: string } | null;
  tagged: boolean;
  interview_id: number | null;
  bot_status: string | null;
  skip_reason: string | null;
}

export const calendarApi = {
  providers: () => req<ProviderInfo[]>("/calendar/providers"),
  connections: () => req<CalendarConnection[]>("/calendar/connections"),
  connectUrl: (provider: string) => req<{ url: string }>(`/calendar/connect/${provider}`),
  setAutoJoin: (id: number, auto_join: AutoJoin) =>
    req<CalendarConnection>(`/calendar/connections/${id}`, { method: "PATCH", body: JSON.stringify({ auto_join }) }),
  disconnect: (id: number) => req<void>(`/calendar/connections/${id}`, { method: "DELETE" }),
  sync: (id: number) => req<{ status: string }>(`/calendar/connections/${id}/sync`, { method: "POST" }),
  events: (connectionId?: number) =>
    req<CalendarEvent[]>(connectionId != null ? `/calendar/events?connection_id=${connectionId}` : "/calendar/events"),
  tag: (id: number, body: { tagged: boolean; candidate_id?: number }) =>
    req<CalendarEvent>(`/calendar/events/${id}/tag`, { method: "POST", body: JSON.stringify(body) }),
};
