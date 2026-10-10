"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Dialog, DialogContent, EmptyState, LoadingRegion, Skeleton, useSnackbar } from "@/components/m3";
import { ApiError, api } from "@/lib/api";
import { calendarApi, type CalendarConnection, type CalendarEvent } from "@/lib/api-calendar";
import { useAuthStore } from "@/lib/auth-store";
import {
  useCalendarEvents,
  useConnections,
  useDisconnect,
  useProviders,
  useSetAutoJoin,
  useSyncNow,
  useTagEvent,
  useTimedFlag,
} from "@/lib/queries/calendar";
import {
  cleanOAuthParams,
  oauthErrorMessage,
  PROVIDER_LABEL,
  readOAuthResult,
  SYNC_POLL_MS,
} from "@/components/calendar/calendar-logic";
import { ConnectionCard } from "@/components/calendar/connection-card";
import { EventList } from "@/components/calendar/event-list";
import { ProviderButtons } from "@/components/calendar/provider-buttons";
import { TagDialog } from "@/components/calendar/tag-dialog";

const msg = (e: unknown) => (e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "Something went wrong");

/** Shows the OAuth result snackbar once, then strips the query params. */
function useOAuthResultToast() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const snackbar = useSnackbar();
  const handled = useRef(false);
  useEffect(() => {
    const result = readOAuthResult(new URLSearchParams(params.toString()));
    if (!result || handled.current) return;
    handled.current = true;
    snackbar.show(result.kind === "connected" ? "Calendar connected. Syncing your meetings now." : oauthErrorMessage(result.code));
    router.replace(cleanOAuthParams(pathname, params.toString()), { scroll: false });
  }, [params, pathname, router, snackbar]);
}

export function CalendarIntegrations() {
  useOAuthResultToast();
  const snackbar = useSnackbar();
  const org = useAuthStore((s) => s.currentOrgId);
  const [polling, startPolling] = useTimedFlag(SYNC_POLL_MS);
  const providers = useProviders();
  const connections = useConnections(polling);
  const events = useCalendarEvents(polling);
  const setAutoJoin = useSetAutoJoin();
  const disconnect = useDisconnect();
  const sync = useSyncNow();
  const tag = useTagEvent();

  const [connecting, setConnecting] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [toDisconnect, setToDisconnect] = useState<CalendarConnection | null>(null);
  const [tagTarget, setTagTarget] = useState<CalendarEvent | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagBusyId, setTagBusyId] = useState<number | null>(null);

  const candidates = useQuery({
    queryKey: ["calendar", org, "candidates"],
    queryFn: () => api.candidates.list(),
    enabled: org != null && tagTarget != null,
  });

  const connect = async (provider: string) => {
    setConnecting(provider);
    try {
      const { url } = await calendarApi.connectUrl(provider);
      window.location.assign(url);
    } catch (e) {
      setConnecting(null);
      snackbar.show(msg(e));
    }
  };

  const onSync = (c: CalendarConnection) => {
    setSyncingId(c.id);
    sync.mutate(c.id, {
      onSuccess: () => {
        snackbar.show("Sync started");
        startPolling();
      },
      onError: (e) => snackbar.show(msg(e)),
      onSettled: () => setSyncingId(null),
    });
  };

  const onToggleTag = (e: CalendarEvent, tagged: boolean) => {
    if (tagged && !e.candidate) {
      setTagError(null);
      setTagTarget(e);
      return;
    }
    setTagBusyId(e.id);
    tag.mutate(
      { id: e.id, tagged },
      {
        onSuccess: () => snackbar.show(tagged ? "Tagged for notetaker" : "Tag removed"),
        onError: (err) => snackbar.show(msg(err)),
        onSettled: () => setTagBusyId(null),
      },
    );
  };

  const confirmTag = (candidateId: number) => {
    if (!tagTarget) return;
    tag.mutate(
      { id: tagTarget.id, tagged: true, candidateId },
      {
        onSuccess: () => {
          snackbar.show("Tagged for notetaker");
          setTagTarget(null);
        },
        onError: (err) =>
          setTagError(err instanceof ApiError && err.code === "candidate_required" ? "Choose which candidate this meeting is with." : msg(err)),
      },
    );
  };

  const list = connections.data ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="title-l text-on-surface">Calendar auto-join</h2>
        <p className="body-m text-on-surface-variant">
          Meetings with candidates become interviews automatically, and the notetaker can join them for you. Calendar
          connections are personal: you only see and manage your own.
        </p>
      </div>

      {connections.isLoading ? (
        <LoadingRegion label="Loading calendar connections" className="space-y-3">
          <Skeleton className="h-48 w-full rounded-md" />
        </LoadingRegion>
      ) : connections.isError ? (
        <Card variant="outlined" className="p-5">
          <p role="alert" className="body-m text-error">
            {msg(connections.error)}
          </p>
          <Button className="mt-3" variant="tonal" onClick={() => connections.refetch()}>
            Try again
          </Button>
        </Card>
      ) : list.length === 0 ? (
        <Card variant="outlined">
          <EmptyState icon="calendar_month" title="No calendar connected">
            Connect Google Calendar or Outlook so meetings with candidates become interviews automatically.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              syncing={syncingId === c.id}
              reconnecting={connecting === c.provider}
              savingAutoJoin={setAutoJoin.isPending}
              onReconnect={() => connect(c.provider)}
              onSync={() => onSync(c)}
              onDisconnect={() => setToDisconnect(c)}
              onAutoJoinChange={(autoJoin) =>
                setAutoJoin.mutate(
                  { id: c.id, autoJoin },
                  { onSuccess: () => snackbar.show("Auto-join updated"), onError: (e) => snackbar.show(msg(e)) },
                )
              }
            />
          ))}
        </div>
      )}

      <section aria-labelledby="cal-connect" className="space-y-3">
        <h3 id="cal-connect" className="title-m text-on-surface">
          {list.length ? "Connect another calendar" : "Connect a calendar"}
        </h3>
        {providers.isLoading ? (
          <Skeleton className="h-10 w-64 rounded-full" />
        ) : (
          <ProviderButtons providers={providers.data ?? []} connecting={connecting} onConnect={connect} />
        )}
      </section>

      {list.length > 0 && (
        <section aria-labelledby="cal-events" className="space-y-3">
          <h3 id="cal-events" className="title-m text-on-surface">
            Upcoming meetings
          </h3>
          {events.isError ? (
            <p role="alert" className="body-m text-error">
              {msg(events.error)}
            </p>
          ) : (
            <EventList events={events.data} loading={events.isLoading} onToggleTag={onToggleTag} busyId={tagBusyId} />
          )}
        </section>
      )}

      <Dialog open={toDisconnect != null} onOpenChange={(o) => !o && setToDisconnect(null)}>
        {toDisconnect && (
          <DialogContent
            icon="link_off"
            title={`Disconnect ${PROVIDER_LABEL[toDisconnect.provider] ?? toDisconnect.provider}?`}
            description={`Access for ${toDisconnect.account_email} will be revoked and notetakers that were scheduled automatically will be cancelled. Existing interviews are kept.`}
            actions={
              <>
                <Button variant="text" onClick={() => setToDisconnect(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(toDisconnect.id, {
                      onSuccess: () => {
                        snackbar.show("Calendar disconnected");
                        setToDisconnect(null);
                      },
                      onError: (e) => snackbar.show(msg(e)),
                    })
                  }
                >
                  Disconnect
                </Button>
              </>
            }
          />
        )}
      </Dialog>

      <TagDialog
        event={tagTarget}
        candidates={(candidates.data ?? []).map((c) => ({ id: Number(c.id), name: c.name }))}
        loading={candidates.isLoading}
        submitting={tag.isPending}
        error={tagError}
        onConfirm={confirmTag}
        onClose={() => setTagTarget(null)}
      />
    </div>
  );
}
