"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CandidateAvatar,
  Card,
  Dialog,
  DialogContent,
  EmptyState,
  FilterChip,
  Icon,
  IconButton,
  LoadingRegion,
  PageHeader,
  SearchBar,
  SegmentedButton,
  Select,
  Skeleton,
  Slider,
  StaggerItem,
  scoreTone,
  stageTone,
  toneText,
} from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { DEFAULT_POOL_FILTERS, filterPool, type PoolFilters } from "@/components/ranking/pool-filter";
import { api } from "@/lib/api";
import { apiMessage, type PoolCandidate } from "@/lib/api-ranking";
import { usePool, useRoles } from "@/lib/queries/ranking";
import { CAN } from "@/lib/roles";
import { cn } from "@/lib/utils";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

function BestMatch({ c }: { c: PoolCandidate }) {
  const m = c.best_match;
  if (!m) return <span className="text-on-surface-variant">—</span>;
  return (
    <Link
      href={`/roles/${m.role_id}?tab=ranking`}
      className="focus-ring inline-flex items-center gap-1 rounded-sm label-l text-primary hover:underline"
    >
      {m.role_name}
      {m.score != null && <span className={cn("tabular-nums", toneText[scoreTone(m.score)])}>{Math.round(m.score)}%</span>}
    </Link>
  );
}

export default function TalentPoolPage() {
  const pool = usePool();
  const roles = useRoles();
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "grid">("list");
  const [filters, setFilters] = useState<PoolFilters>(DEFAULT_POOL_FILTERS);
  const [toDelete, setToDelete] = useState<PoolCandidate | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.candidates.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setToDelete(null);
    },
  });

  const all = useMemo(() => pool.data ?? [], [pool.data]);
  const sources = useMemo(() => Array.from(new Set(all.map((c) => c.source ?? "manual"))).sort(), [all]);
  const shown = useMemo(() => filterPool(all, filters), [all, filters]);
  const set = (p: Partial<PoolFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Talent Pool"
        subtitle={pool.isLoading ? "Loading…" : `${shown.length} of ${all.length} candidates`}
        actions={
          <>
            <SegmentedButton
              aria-label="View"
              value={view}
              onValueChange={setView}
              options={[
                { value: "list", label: "List", icon: "view_list" },
                { value: "grid", label: "Grid", icon: "grid_view" },
              ]}
            />
            <RequireRole roles={CAN.create}>
              <Button asChild icon="add">
                <Link href="/candidate/new">Add Candidate</Link>
              </Button>
            </RequireRole>
          </>
        }
      />

      <div className="space-y-3">
        <SearchBar
          value={filters.search}
          onValueChange={(v) => set({ search: v })}
          placeholder="Search by name or role…"
          containerClassName="expanded:max-w-sm"
        />
        <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-2">
          <FilterChip label="All roles" selected={filters.roleId === null} onSelectedChange={() => set({ roleId: null })} />
          {(roles.data ?? []).map((r) => (
            <FilterChip key={r.id} label={r.name} selected={filters.roleId === r.id} onSelectedChange={(on) => set({ roleId: on ? r.id : null })} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            className="w-44"
            label="Stage"
            leadingIcon="filter_list"
            value={filters.stage}
            onValueChange={(v) => set({ stage: v })}
            options={[{ value: "all", label: "All stages" }, ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))]}
          />
          <div className="w-52">
            <p className="label-m text-on-surface-variant">Min score {filters.minScore}</p>
            <Slider aria-label="Minimum score" min={0} max={100} step={5} value={[filters.minScore]} onValueChange={(v) => set({ minScore: v[0] })} />
          </div>
          <div role="group" aria-label="Filter by source" className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <FilterChip key={s} label={s} selected={filters.source === s} onSelectedChange={(on) => set({ source: on ? s : "all" })} />
            ))}
          </div>
          <FilterChip label="Interviewed" selected={filters.interviewedOnly} onSelectedChange={(on) => set({ interviewedOnly: on })} />
        </div>
      </div>

      {pool.isLoading ? (
        <LoadingRegion label="Loading candidates" className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </LoadingRegion>
      ) : pool.isError ? (
        <EmptyState icon="error" title="Could not load candidates">
          {apiMessage(pool.error)}
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="groups" title={all.length ? "No candidates match your filters" : "No candidates yet"}>
          {all.length ? (
            <button type="button" className="text-primary hover:underline" onClick={() => setFilters(DEFAULT_POOL_FILTERS)}>
              Clear filters
            </button>
          ) : (
            <RequireRole roles={CAN.create}>
              <span>Add a candidate, or bulk-upload resumes from a role&apos;s Ranking tab.</span>
            </RequireRole>
          )}
        </EmptyState>
      ) : view === "list" ? (
        <Card variant="outlined" className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-outline-variant">
                {["Candidate", "Role", "Best matching role", "Stage", "Score", "Source", ""].map((h, i) => (
                  <th key={i} scope="col" className="px-5 py-3 text-left label-m uppercase text-on-surface-variant">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((c, i) => (
                <StaggerItem as="tr" key={c.id} index={i} className="group border-b border-outline-variant/50 last:border-0 hover:bg-on-surface/4">
                  <td className="px-5 py-3">
                    <Link href={`/candidate/${c.id}`} className="focus-ring flex items-center gap-3 rounded-md">
                      <CandidateAvatar name={c.name} initials={c.avatar} src={c.avatar_url} size="sm" />
                      <div>
                        <p className="flex items-center gap-1 title-s text-on-surface">
                          {c.name}
                          {c.interviewed && <Icon name="mic" size={14} className="text-ai" label="Interviewed" />}
                        </p>
                        <p className="body-s text-on-surface-variant">{c.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3 body-m text-on-surface-variant">{c.role}</td>
                  <td className="px-5 py-3">
                    <BestMatch c={c} />
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(c.stage).chip)}>
                      {STAGE_LABELS[c.stage] ?? c.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("title-s tabular-nums", toneText[scoreTone(c.score)])}>{c.score > 0 ? `${c.score}%` : "—"}</span>
                  </td>
                  <td className="px-5 py-3 body-s capitalize text-on-surface-variant">{c.source ?? "manual"}</td>
                  <td className="px-3 py-3">
                    <RequireRole roles={CAN.create}>
                      <IconButton
                        icon="delete"
                        label={`Delete ${c.name}`}
                        size="sm"
                        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-error"
                        onClick={() => setToDelete(c)}
                      />
                    </RequireRole>
                  </td>
                </StaggerItem>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <ul className="grid gap-4 medium:grid-cols-2 expanded:grid-cols-3 large:grid-cols-4">
          {shown.map((c, i) => (
            <StaggerItem as="li" key={c.id} index={i}>
              <Card variant="outlined" className="h-full space-y-3 p-4">
                <Link href={`/candidate/${c.id}`} className="focus-ring flex items-center gap-3 rounded-md">
                  <CandidateAvatar name={c.name} initials={c.avatar} src={c.avatar_url} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate title-s text-on-surface">{c.name}</p>
                    <p className="truncate body-s text-on-surface-variant">{c.role}</p>
                  </div>
                  <span className={cn("ms-auto title-m tabular-nums", toneText[scoreTone(c.score)])}>{c.score > 0 ? `${c.score}%` : "—"}</span>
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(c.stage).chip)}>
                    {STAGE_LABELS[c.stage] ?? c.stage}
                  </span>
                  <span className="body-s capitalize text-on-surface-variant">{c.source ?? "manual"}</span>
                </div>
                <p className="body-s text-on-surface-variant">
                  Best match: <BestMatch c={c} />
                </p>
                <RequireRole roles={CAN.create}>
                  <IconButton icon="delete" label={`Delete ${c.name}`} size="sm" onClick={() => setToDelete(c)} />
                </RequireRole>
              </Card>
            </StaggerItem>
          ))}
        </ul>
      )}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent
          icon="delete"
          title={`Remove ${toDelete?.name ?? "candidate"}?`}
          description="This deletes all their data, analyses and files."
          actions={
            <>
              <Button variant="text" onClick={() => setToDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={del.isPending} onClick={() => toDelete && del.mutate(toDelete.id)}>
                Delete
              </Button>
            </>
          }
        >
          {del.isError && (
            <p role="alert" className="body-m text-error">
              {apiMessage(del.error)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
