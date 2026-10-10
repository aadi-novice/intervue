"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarApi, type AutoJoin } from "../api-calendar";
import { useAuthStore } from "../auth-store";

export const calKeys = {
  all: (org: number | null) => ["calendar", org] as const,
  providers: (org: number | null) => ["calendar", org, "providers"] as const,
  connections: (org: number | null) => ["calendar", org, "connections"] as const,
  events: (org: number | null, connectionId?: number) => ["calendar", org, "events", connectionId ?? "all"] as const,
};

function useOrg() {
  return useAuthStore((s) => s.currentOrgId);
}

export function useProviders() {
  const org = useOrg();
  return useQuery({ queryKey: calKeys.providers(org), queryFn: calendarApi.providers, enabled: org != null });
}

/** `poll` true refetches every 2s (used briefly after "Sync now"). */
export function useConnections(poll = false) {
  const org = useOrg();
  return useQuery({
    queryKey: calKeys.connections(org),
    queryFn: calendarApi.connections,
    enabled: org != null,
    refetchInterval: poll ? 2000 : false,
  });
}

export function useCalendarEvents(poll = false, connectionId?: number) {
  const org = useOrg();
  return useQuery({
    queryKey: calKeys.events(org, connectionId),
    queryFn: () => calendarApi.events(connectionId),
    enabled: org != null,
    refetchInterval: poll ? 2000 : false,
  });
}

export function useSetAutoJoin() {
  const qc = useQueryClient();
  const org = useOrg();
  return useMutation({
    mutationFn: ({ id, autoJoin }: { id: number; autoJoin: AutoJoin }) => calendarApi.setAutoJoin(id, autoJoin),
    onSuccess: () => qc.invalidateQueries({ queryKey: calKeys.all(org) }),
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  const org = useOrg();
  return useMutation({
    mutationFn: (id: number) => calendarApi.disconnect(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: calKeys.all(org) }),
  });
}

export function useSyncNow() {
  return useMutation({ mutationFn: (id: number) => calendarApi.sync(id) });
}

export function useTagEvent() {
  const qc = useQueryClient();
  const org = useOrg();
  return useMutation({
    mutationFn: ({ id, tagged, candidateId }: { id: number; tagged: boolean; candidateId?: number }) =>
      calendarApi.tag(id, candidateId != null ? { tagged, candidate_id: candidateId } : { tagged }),
    onSuccess: () => qc.invalidateQueries({ queryKey: calKeys.all(org) }),
  });
}

/** Returns [active, start]; active stays true for `ms` after start() is called. */
export function useTimedFlag(ms: number): [boolean, () => void] {
  const [stamp, setStamp] = useState(0);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(true);
    const t = window.setTimeout(() => setActive(false), ms);
    return () => window.clearTimeout(t);
  }, [stamp, ms]);
  return [active, () => setStamp(Date.now())];
}
