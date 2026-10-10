"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { SearchBar } from "./search";

export interface TranscriptSegment {
  id: string;
  speaker_label: string;
  speaker_kind: "interviewer" | "candidate" | "unknown";
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  /** Called when a timestamp is clicked. */
  onSeek?: (ms: number) => void;
  /** Current playback position; highlights the active segment. */
  currentMs?: number;
  height?: number | string;
  className?: string;
}

const SPEAKER: Record<TranscriptSegment["speaker_kind"], { chip: string; bar: string }> = {
  interviewer: { chip: "bg-primary-container text-on-primary-container", bar: "bg-primary" },
  candidate: { chip: "bg-tertiary-container text-on-tertiary-container", bar: "bg-tertiary" },
  unknown: { chip: "bg-surface-container-highest text-on-surface-variant", bar: "bg-outline" },
};

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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

/** Virtualised, searchable transcript with speaker colours and click-to-seek timestamps. */
export function TranscriptViewer({ segments, onSeek, currentMs, height = 480, className }: TranscriptViewerProps) {
  const [query, setQuery] = React.useState("");
  const [matchIdx, setMatchIdx] = React.useState(0);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const q = query.trim();
  const matches = React.useMemo(() => {
    if (!q) return [] as number[];
    const lower = q.toLowerCase();
    const out: number[] = [];
    segments.forEach((s, i) => {
      if (s.text.toLowerCase().includes(lower)) out.push(i);
    });
    return out;
  }, [segments, q]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unmemoizable fns; the component is not memoized by consumers
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
    getItemKey: (i) => segments[i].id,
  });

  const jump = (n: number) => {
    if (matches.length === 0) return;
    const next = (n + matches.length) % matches.length;
    setMatchIdx(next);
    virtualizer.scrollToIndex(matches[next], { align: "center" });
  };

  const activeIndex = React.useMemo(() => {
    if (currentMs == null) return -1;
    return segments.findIndex((s) => currentMs >= s.start_ms && currentMs < s.end_ms);
  }, [segments, currentMs]);

  const currentMatch = matches[matchIdx];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
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
        ref={parentRef}
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
              const sp = SPEAKER[s.speaker_kind];
              const active = v.index === activeIndex;
              const isMatch = v.index === currentMatch;
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    "absolute left-0 top-0 flex w-full gap-3 px-4 py-3 transition-colors",
                    active && "bg-secondary-container/50",
                    isMatch && "bg-tertiary-container/30",
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
    </div>
  );
}
