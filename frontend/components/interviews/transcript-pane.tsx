"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconButton, SearchBar } from "@/components/m3";
import { formatTimestamp } from "@/components/m3/transcript-viewer";
import type { Segment } from "@/lib/api-interviews";
import { cn } from "@/lib/utils";

const SPEAKER: Record<string, { chip: string; bar: string }> = {
  interviewer: { chip: "bg-primary-container text-on-primary-container", bar: "bg-primary" },
  candidate: { chip: "bg-tertiary-container text-on-tertiary-container", bar: "bg-tertiary" },
  unknown: { chip: "bg-surface-container-highest text-on-surface-variant", bar: "bg-outline" },
};

/** Index of the segment playing at `ms` (last segment that has started, within its span). */
export function activeSegmentIndex(segments: readonly Pick<Segment, "start_ms" | "end_ms">[], ms: number | undefined): number {
  if (ms == null) return -1;
  return segments.findIndex((s) => ms >= s.start_ms && ms < s.end_ms);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "ig"));
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

/**
 * Virtualised transcript with search, speaker colours, click-to-seek timestamps,
 * playback highlight and deep-link focus (`focusId` scrolls to and highlights a segment).
 */
export function TranscriptPane({
  segments,
  currentMs,
  onSeek,
  focusId,
  loadingMore,
  height = 520,
}: {
  segments: Segment[];
  currentMs?: number;
  onSeek?: (ms: number) => void;
  focusId?: number | null;
  loadingMore?: boolean;
  height?: number;
}) {
  const parent = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [matchIdx, setMatchIdx] = React.useState(0);

  const q = query.trim();
  const matches = React.useMemo(() => {
    if (!q) return [] as number[];
    const lower = q.toLowerCase();
    const out: number[] = [];
    segments.forEach((s, i) => s.text.toLowerCase().includes(lower) && out.push(i));
    return out;
  }, [segments, q]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unmemoizable fns
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 88,
    overscan: 8,
    getItemKey: (i) => segments[i].id,
  });

  const focusIndex = React.useMemo(() => (focusId == null ? -1 : segments.findIndex((s) => s.id === focusId)), [segments, focusId]);
  const scrolled = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (focusIndex >= 0 && scrolled.current !== focusId) {
      scrolled.current = focusId ?? null;
      virtualizer.scrollToIndex(focusIndex, { align: "center" });
    }
  }, [focusIndex, focusId, virtualizer]);

  const jump = (n: number) => {
    if (matches.length === 0) return;
    const next = (n + matches.length) % matches.length;
    setMatchIdx(next);
    virtualizer.scrollToIndex(matches[next], { align: "center" });
  };

  const active = activeSegmentIndex(segments, currentMs);
  const currentMatch = matches[matchIdx];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <SearchBar
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setMatchIdx(0);
          }}
          placeholder="Search transcript"
          containerClassName="h-12 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") jump(matchIdx + (e.shiftKey ? -1 : 1));
          }}
        />
        {q && (
          <>
            <span className="min-w-16 text-center label-m tabular-nums text-on-surface-variant" aria-live="polite">
              {matches.length === 0 ? "0 results" : `${matchIdx + 1} / ${matches.length}`}
            </span>
            <IconButton icon="keyboard_arrow_up" label="Previous match" onClick={() => jump(matchIdx - 1)} disabled={matches.length === 0} />
            <IconButton icon="keyboard_arrow_down" label="Next match" onClick={() => jump(matchIdx + 1)} disabled={matches.length === 0} />
          </>
        )}
      </div>
      <div
        ref={parent}
        role="log"
        aria-label="Transcript"
        tabIndex={0}
        className="focus-ring overflow-y-auto rounded-md bg-surface-container-low"
        style={{ height }}
      >
        {segments.length === 0 ? (
          <p className="p-6 text-center body-m text-on-surface-variant">No transcript yet.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const s = segments[v.index];
              const sp = SPEAKER[s.speaker_kind] ?? SPEAKER.unknown;
              return (
                <div
                  key={v.key}
                  id={`seg-${s.id}`}
                  data-index={v.index}
                  data-focused={s.id === focusId ? "true" : undefined}
                  ref={virtualizer.measureElement}
                  className={cn(
                    "absolute left-0 top-0 flex w-full gap-3 px-4 py-3 transition-colors",
                    v.index === active && "bg-secondary-container/50",
                    v.index === currentMatch && "bg-tertiary-container/30",
                    s.id === focusId && "bg-primary-container/60 ring-2 ring-inset ring-primary",
                  )}
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <span aria-hidden className={cn("w-1 shrink-0 self-stretch rounded-full", sp.bar)} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", sp.chip)}>{s.speaker_label}</span>
                      <button
                        type="button"
                        onClick={() => onSeek?.(s.start_ms)}
                        aria-label={`Jump to ${formatTimestamp(s.start_ms)}`}
                        className="focus-ring rounded-xs px-1 label-m tabular-nums text-primary hover:underline"
                      >
                        {formatTimestamp(s.start_ms)}
                      </button>
                    </div>
                    <p className="body-m text-on-surface">
                      <Highlighted text={s.text} query={q} />
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {loadingMore && (
        <p role="status" className="label-s text-on-surface-variant">
          Loading more of the transcript…
        </p>
      )}
    </div>
  );
}
