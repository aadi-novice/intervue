"use client";

import * as React from "react";
import Link from "next/link";
import { Card, EmptyState, IconButton, LoadingRegion, SegmentedButton, Select, Skeleton, TextField } from "@/components/m3";
import type { InterviewSummary } from "@/lib/api-interviews";
import { useCandidateOptions, useInterviews, useRoleOptions } from "@/lib/queries/interviews";
import { InterviewStatusChip, PlatformIcon, platformLabel } from "./bot-parts";

export const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
export const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

export function formatWhen(iso: string | null): string {
  if (!iso) return "Unscheduled";
  const d = new Date(iso);
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function InterviewRow({ iv, showCandidate = true }: { iv: InterviewSummary; showCandidate?: boolean }) {
  return (
    <Link
      href={`/interviews/${iv.id}`}
      className="state-layer focus-ring relative flex items-center gap-3 rounded-md bg-surface-container p-3"
    >
      <PlatformIcon platform={iv.platform} />
      <div className="min-w-0 flex-1">
        <p className="truncate title-s">{iv.title}</p>
        <p className="truncate body-s text-on-surface-variant">
          {showCandidate && <>{iv.candidate_name} · </>}
          {iv.role_name ? `${iv.role_name} · ` : ""}
          {formatWhen(iv.scheduled_start)} · {platformLabel(iv.platform)}
        </p>
      </div>
      <InterviewStatusChip botStatus={iv.bot_status} interviewStatus={iv.status} />
    </Link>
  );
}

function ListSkeleton() {
  return (
    <LoadingRegion label="Loading interviews" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 rounded-md" />
      ))}
    </LoadingRegion>
  );
}

function WeekCalendar({ items, weekStart }: { items: InterviewSummary[]; weekStart: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const byDay = new Map<string, InterviewSummary[]>();
  for (const iv of items) {
    if (!iv.scheduled_start) continue;
    const k = dayKey(new Date(iv.scheduled_start));
    byDay.set(k, [...(byDay.get(k) ?? []), iv]);
  }
  const today = dayKey(new Date());
  return (
    <ol className="grid gap-2 medium:grid-cols-7" aria-label="Week calendar">
      {days.map((d) => {
        const list = (byDay.get(dayKey(d)) ?? []).sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
        const isToday = dayKey(d) === today;
        return (
          <li key={d.toISOString()} className={`min-h-28 rounded-md p-2 ${isToday ? "bg-primary-container/40" : "bg-surface-container-low"}`}>
            <p className="mb-2 label-m text-on-surface-variant" aria-current={isToday ? "date" : undefined}>
              {dateFmt.format(d)}
            </p>
            <ul className="space-y-1">
              {list.map((iv) => (
                <li key={iv.id}>
                  <Link
                    href={`/interviews/${iv.id}`}
                    className="focus-ring block rounded-sm bg-surface-container-high p-2 body-s hover:bg-surface-container-highest"
                  >
                    <span className="block label-s tabular-nums text-on-surface-variant">
                      {timeFmt.format(new Date(iv.scheduled_start as string))}
                    </span>
                    <span className="block truncate label-l">{iv.candidate_name}</span>
                    <span className="block truncate label-s text-on-surface-variant">{iv.title}</span>
                    {iv.bot_status && <span className="sr-only">Notetaker: {iv.bot_status}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

/** Interviews list + week calendar with role / candidate / date-range filters. */
export function InterviewsExplorer() {
  const [view, setView] = React.useState<"list" | "calendar">("list");
  const [roleId, setRoleId] = React.useState("all");
  const [candId, setCandId] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date()));

  const roles = useRoleOptions();
  const candidates = useCandidateOptions();

  const filters = React.useMemo(() => {
    const f: { from?: string; to?: string; role_id?: number; candidate_id?: number } = {};
    if (roleId !== "all") f.role_id = Number(roleId);
    if (candId !== "all") f.candidate_id = Number(candId);
    if (view === "calendar") {
      f.from = weekStart.toISOString();
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 7);
      f.to = end.toISOString();
    } else {
      if (from) f.from = new Date(`${from}T00:00:00`).toISOString();
      if (to) f.to = new Date(`${to}T23:59:59`).toISOString();
    }
    return f;
  }, [roleId, candId, from, to, view, weekStart]);

  const q = useInterviews(filters);
  const items = React.useMemo(
    () => [...(q.data ?? [])].sort((a, b) => (b.scheduled_start ?? b.created_at).localeCompare(a.scheduled_start ?? a.created_at)),
    [q.data],
  );

  const shiftWeek = (n: number) =>
    setWeekStart((w) => {
      const d = new Date(w);
      d.setDate(d.getDate() + 7 * n);
      return d;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedButton
          value={view}
          onValueChange={setView}
          options={[
            { value: "list", label: "List", icon: "list" },
            { value: "calendar", label: "Week", icon: "calendar_view_week" },
          ]}
        />
        <Select
          label="Role"
          className="w-48"
          value={roleId}
          onValueChange={setRoleId}
          options={[{ value: "all", label: "All roles" }, ...(roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name }))]}
        />
        <Select
          label="Candidate"
          className="w-56"
          value={candId}
          onValueChange={setCandId}
          options={[{ value: "all", label: "All candidates" }, ...(candidates.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        {view === "list" ? (
          <>
            <TextField label="From" type="date" containerClassName="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="To" type="date" containerClassName="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : (
          <div className="flex items-center gap-1">
            <IconButton icon="chevron_left" label="Previous week" onClick={() => shiftWeek(-1)} />
            <span className="min-w-36 text-center label-l">Week of {dateFmt.format(weekStart)}</span>
            <IconButton icon="chevron_right" label="Next week" onClick={() => shiftWeek(1)} />
          </div>
        )}
      </div>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <p role="alert" className="body-m text-error">
          Couldn&apos;t load interviews. {(q.error as Error).message}
        </p>
      ) : view === "calendar" ? (
        <WeekCalendar items={items} weekStart={weekStart} />
      ) : items.length === 0 ? (
        <Card variant="outlined" className="border-dashed">
          <EmptyState icon="event" title="No interviews found">
            Schedule an interview or paste a meeting link to get started.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((iv) => (
            <li key={iv.id}>
              <InterviewRow iv={iv} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
