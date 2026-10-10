"use client";

import * as React from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, EmptyState, Icon, LinearProgress, LoadingRegion, Select, Skeleton, Slider, StaggerItem, Switch } from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { apiMessage, type RankingFilters, type RankingPageData, type StageName } from "@/lib/api-ranking";
import { useRankings, useRankStatus, useStartRank } from "@/lib/queries/ranking";
import { CAN } from "@/lib/roles";
import { BulkUpload } from "./bulk-upload";
import { CandidateSummaryCard } from "./candidate-summary-card";

export const VIRTUALISE_OVER = 100;
export const MAX_COMPARE = 4;

const STAGE_OPTIONS = [
  { value: "all", label: "All stages" },
  { value: "applied", label: "Applied" },
  { value: "screening", label: "AI Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
];

export function rankProgressText(page: RankingPageData | undefined): string | null {
  if (!page) return null;
  const p = page.rank_progress as { total?: number; scored?: number } | null;
  if (page.rank_status === "queued") return "Ranking queued…";
  if (page.rank_status === "running") {
    const total = p?.total ?? 0;
    return total ? `Ranking… ${p?.scored ?? 0}/${total} scored` : "Ranking… shortlisting candidates";
  }
  return null;
}

export function formatCost(usd: number | null | undefined): string | null {
  if (usd == null) return null;
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function Filters({
  value,
  onChange,
}: {
  value: RankingFilters;
  onChange: (f: RankingFilters) => void;
}) {
  const [range, setRange] = React.useState<[number, number]>([value.minScore ?? 0, value.maxScore ?? 100]);
  return (
    <section aria-label="Ranking filters" className="grid gap-4 rounded-md bg-surface-container-low p-4 medium:grid-cols-2 expanded:grid-cols-4">
      <Switch
        label="Must-haves met"
        checked={!!value.mustHavesMet}
        onCheckedChange={(v) => onChange({ ...value, mustHavesMet: v })}
      />
      <Switch label="Interviewed" checked={!!value.interviewed} onCheckedChange={(v) => onChange({ ...value, interviewed: v })} />
      <Select
        label="Stage"
        value={value.stage || "all"}
        onValueChange={(v) => onChange({ ...value, stage: v === "all" ? "" : (v as StageName) })}
        options={STAGE_OPTIONS}
      />
      <div>
        <p className="label-m text-on-surface-variant">
          Score {range[0]}–{range[1]}
        </p>
        <Slider
          aria-label="Score range"
          min={0}
          max={100}
          step={5}
          value={range}
          onValueChange={(v) => setRange([v[0], v[1]])}
          onValueCommit={(v) => onChange({ ...value, minScore: v[0], maxScore: v[1] })}
        />
      </div>
    </section>
  );
}

function CardList({
  items,
  selected,
  toggle,
}: {
  items: RankingPageData["items"];
  selected: number[];
  toggle: (id: number, on: boolean) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const virtual = items.length > VIRTUALISE_OVER;
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 360,
    overscan: 4,
    enabled: virtual,
  });
  const renderCard = (c: RankingPageData["items"][number], i: number) => (
    <div className="flex items-start gap-3">
      <span className="mt-4 w-7 shrink-0 text-end label-l tabular-nums text-on-surface-variant" aria-label={`Rank ${i + 1}`}>
        {i + 1}
      </span>
      <div className="min-w-0 flex-1">
        <CandidateSummaryCard
          card={c}
          selected={selected.includes(c.candidate.id)}
          onSelectedChange={(on) => toggle(c.candidate.id, on)}
          selectDisabled={selected.length >= MAX_COMPARE}
        />
      </div>
    </div>
  );

  if (!virtual) {
    return (
      <ol className="flex flex-col gap-4">
        {items.map((c, i) => (
          <StaggerItem as="li" key={c.candidate.id} index={i}>
            {renderCard(c, i)}
          </StaggerItem>
        ))}
      </ol>
    );
  }
  return (
    <div ref={scrollRef} className="max-h-[75dvh] overflow-y-auto" data-testid="virtual-list">
      <ol className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((v) => {
          const c = items[v.index];
          return (
            <li
              key={c.candidate.id}
              data-index={v.index}
              ref={rowVirtualizer.measureElement}
              className="absolute inset-x-0 top-0 pb-4"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {renderCard(c, v.index)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RankingTab({ roleId }: { roleId: number }) {
  const [filters, setFilters] = React.useState<RankingFilters>({});
  const [selected, setSelected] = React.useState<number[]>([]);
  const status = useRankStatus(roleId);
  const start = useStartRank(roleId);
  const polling = status.data?.status === "queued" || status.data?.status === "running";
  const rankings = useRankings(roleId, filters, polling);
  const page = rankings.data;
  const progress = rankProgressText(page) ?? (polling ? "Ranking…" : null);
  const percent = (() => {
    const p = page?.rank_progress as { total?: number; scored?: number } | null | undefined;
    return p?.total ? ((p.scored ?? 0) / p.total) * 100 : undefined;
  })();
  const cost = formatCost(page?.cost_usd);
  const failedMsg = page?.rank_status === "failed" ? (page.rank_error ?? "Ranking failed") : null;

  const toggle = (id: number, on: boolean) =>
    setSelected((s) => (on ? (s.includes(id) || s.length >= MAX_COMPARE ? s : [...s, id]) : s.filter((x) => x !== id)));

  return (
    <div className="space-y-4">
      <BulkUpload roleId={roleId} />

      <div className="flex flex-wrap items-center gap-3">
        <RequireRole roles={CAN.create}>
          <Button
            icon="psychology"
            loading={start.isPending || polling}
            onClick={() => start.mutate()}
          >
            {polling ? "Ranking…" : "Rank now"}
          </Button>
        </RequireRole>
        <div aria-live="polite" className="min-w-0 flex-1 space-y-1">
          {progress && <p className="label-l text-on-surface">{progress}</p>}
          {polling && <LinearProgress value={percent} aria-label="Ranking progress" />}
          {!polling && page && (
            <p className="body-s text-on-surface-variant">
              {page.scored_count} scored of {page.total} candidates
              {cost && (
                <>
                  {" · "}
                  <span title="Total LLM cost of the latest ranking run">Latest run cost {cost}</span>
                </>
              )}
            </p>
          )}
        </div>
        <Button
          variant="tonal"
          icon="compare_arrows"
          disabled={selected.length < 2}
          asChild={selected.length >= 2}
        >
          {selected.length >= 2 ? (
            <Link href={`/compare?role=${roleId}&ids=${selected.join(",")}`}>Compare ({selected.length})</Link>
          ) : (
            <span>Compare ({selected.length}/2–{MAX_COMPARE})</span>
          )}
        </Button>
      </div>

      {(failedMsg || start.isError) && (
        <p role="alert" className="flex items-start gap-2 rounded-sm bg-error-container px-3 py-2 body-m text-on-error-container">
          <Icon name="error" size={18} />
          {start.isError ? apiMessage(start.error) : `Ranking failed: ${(failedMsg ?? "").length > 160 ? `${(failedMsg ?? "").slice(0, 160)}…` : failedMsg}`}
        </p>
      )}

      <Filters value={filters} onChange={setFilters} />

      {rankings.isLoading ? (
        <LoadingRegion label="Loading rankings" className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-md" />
          ))}
        </LoadingRegion>
      ) : rankings.isError ? (
        <EmptyState icon="error" title="Could not load rankings">
          {apiMessage(rankings.error)}
        </EmptyState>
      ) : !page || page.items.length === 0 ? (
        <EmptyState icon="groups" title={page && page.total > 0 ? "No candidates match these filters" : "No ranked candidates yet"}>
          {page && page.total > 0
            ? "Loosen the filters above."
            : "Drop resumes above, define a rubric, then press Rank now."}
        </EmptyState>
      ) : (
        <CardList items={page.items} selected={selected} toggle={toggle} />
      )}
    </div>
  );
}
