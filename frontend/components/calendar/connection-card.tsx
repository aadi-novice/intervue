"use client";

import { Button, Card, Icon, SegmentedButton } from "@/components/m3";
import type { AutoJoin, CalendarConnection, ConnectionStatus } from "@/lib/api-calendar";
import { AUTO_JOIN_OPTIONS, PROVIDER_LABEL } from "./calendar-logic";

const STATUS_META: Record<ConnectionStatus, { label: string; className: string }> = {
  active: { label: "Connected", className: "bg-match-strong-container text-on-match-strong-container" },
  needs_reauth: { label: "Needs reconnect", className: "bg-match-medium-container text-on-match-medium-container" },
  error: { label: "Sync error", className: "bg-error-container text-on-error-container" },
};

export function ConnectionStatusChip({ status }: { status: ConnectionStatus }) {
  const m = STATUS_META[status];
  return (
    <span role="status" className={`inline-flex h-6 items-center rounded-sm px-2 label-m ${m.className}`}>
      {m.label}
    </span>
  );
}

export function formatSynced(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const d = new Date(iso);
  return `Last synced ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d)}`;
}

export interface ConnectionCardProps {
  connection: CalendarConnection;
  onAutoJoinChange: (autoJoin: AutoJoin) => void;
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  syncing?: boolean;
  reconnecting?: boolean;
  savingAutoJoin?: boolean;
}

export function ConnectionCard({
  connection: c,
  onAutoJoinChange,
  onReconnect,
  onSync,
  onDisconnect,
  syncing,
  reconnecting,
  savingAutoJoin,
}: ConnectionCardProps) {
  const providerName = PROVIDER_LABEL[c.provider] ?? c.provider;
  const current = AUTO_JOIN_OPTIONS.find((o) => o.value === c.auto_join);
  return (
    <Card variant="outlined" className="p-5" aria-label={`${providerName} ${c.account_email}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container">
          <Icon name="calendar_month" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="title-m text-on-surface">{providerName}</p>
          <p className="truncate body-m text-on-surface-variant">{c.account_email}</p>
          <p className="mt-1 body-s text-on-surface-variant" aria-live="polite">
            {formatSynced(c.last_synced_at)}
          </p>
        </div>
        <ConnectionStatusChip status={c.status} />
      </div>

      {c.status === "needs_reauth" && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-match-medium-container p-4 text-on-match-medium-container">
          <Icon name="warning" />
          <p className="min-w-0 flex-1 body-m">Access to this calendar expired or was revoked. Reconnect to resume syncing.</p>
          <Button icon="refresh" onClick={onReconnect} loading={reconnecting}>
            Reconnect
          </Button>
        </div>
      )}
      {c.status === "error" && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-md bg-error-container p-4 text-on-error-container">
          <Icon name="error" />
          <p className="min-w-0 flex-1 body-m">{c.last_error || "The last sync failed. We will retry automatically."}</p>
        </div>
      )}

      <div className="mt-5">
        <p id={`aj-${c.id}`} className="label-l text-on-surface">
          Notetaker auto-join
        </p>
        <SegmentedButton<AutoJoin>
          aria-label={`Notetaker auto-join for ${c.account_email}`}
          className="mt-2 w-full max-w-sm"
          value={c.auto_join}
          onValueChange={(v) => v !== c.auto_join && onAutoJoinChange(v)}
          options={AUTO_JOIN_OPTIONS.map((o) => ({ value: o.value, label: o.short, disabled: savingAutoJoin }))}
        />
        <p className="mt-2 body-m text-on-surface">{current?.label}</p>
        <p className="body-s text-on-surface-variant">{current?.description}</p>
        <p className="mt-2 body-s text-on-surface-variant">
          A consent message is always posted in the meeting chat by the notetaker. Only admins, recruiters and hiring
          managers can have the notetaker scheduled automatically.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="tonal" icon="sync" onClick={onSync} loading={syncing} disabled={c.status === "needs_reauth"}>
          Sync now
        </Button>
        <Button variant="text" icon="link_off" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </Card>
  );
}
