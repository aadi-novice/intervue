"use client";

import Link from "next/link";
import { BotStatusChip, Card, EmptyState, Icon, Skeleton, Switch, LoadingRegion, type BotStatus } from "@/components/m3";
import { BOT_STATUS_META } from "@/components/m3/bot-status-chip";
import { PlatformIcon } from "@/components/interviews/bot-parts";
import { detectPlatform } from "@/lib/interviews-logic";
import type { CalendarEvent } from "@/lib/api-calendar";
import { formatEventTime, groupEventsByDay, skipReasonMessage } from "./calendar-logic";

export function EventRow({
  event: e,
  onToggleTag,
  busy,
}: {
  event: CalendarEvent;
  onToggleTag: (event: CalendarEvent, tagged: boolean) => void;
  busy?: boolean;
}) {
  const platform = e.platform ?? (e.meeting_url ? detectPlatform(e.meeting_url) : null);
  const skip = skipReasonMessage(e.skip_reason);
  const known = e.bot_status != null && e.bot_status in BOT_STATUS_META;
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center gap-3">
        {platform ? <PlatformIcon platform={platform} /> : <Icon name="event" size={20} className="text-on-surface-variant" />}
        <div className="min-w-0 flex-1">
          <p className="truncate title-s text-on-surface">{e.title}</p>
          <p className="body-s text-on-surface-variant">{formatEventTime(e.start, e.end)}</p>
        </div>
        {e.candidate ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-secondary-container px-2 label-m text-on-secondary-container">
            <Icon name="person" size={16} />
            {e.candidate.name}
          </span>
        ) : (
          <span className="inline-flex h-6 items-center rounded-sm bg-surface-container-highest px-2 label-m text-on-surface-variant">
            No candidate matched
          </span>
        )}
        {known && <BotStatusChip status={e.bot_status as BotStatus} />}
        {e.interview_id != null && (
          <Link href={`/interviews/${e.interview_id}`} className="focus-ring rounded-sm label-l text-primary underline-offset-2 hover:underline">
            View interview
          </Link>
        )}
        <Switch
          aria-label={`Tag "${e.title}" for notetaker`}
          checked={e.tagged}
          disabled={busy}
          onCheckedChange={(v) => onToggleTag(e, v)}
        />
        <span className="label-m text-on-surface-variant" aria-hidden>
          Tag for notetaker
        </span>
      </div>
      {skip && <p className="ps-8 body-s text-on-surface-variant">{skip}</p>}
    </li>
  );
}

export function EventList({
  events,
  loading,
  onToggleTag,
  busyId,
}: {
  events: CalendarEvent[] | undefined;
  loading: boolean;
  onToggleTag: (event: CalendarEvent, tagged: boolean) => void;
  busyId?: number | null;
}) {
  if (loading) {
    return (
      <LoadingRegion label="Loading upcoming meetings" className="space-y-3">
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </LoadingRegion>
    );
  }
  if (!events || events.length === 0) {
    return (
      <EmptyState icon="event_busy" title="No upcoming meetings">
        Synced meetings with video links will appear here.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {groupEventsByDay(events).map((g) => (
        <Card key={g.key} variant="outlined" className="px-5 py-2">
          <h3 className="pt-3 label-l text-on-surface-variant">{g.label}</h3>
          <ul className="divide-y divide-outline-variant">
            {g.events.map((e) => (
              <EventRow key={e.id} event={e} onToggleTag={onToggleTag} busy={busyId === e.id} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
