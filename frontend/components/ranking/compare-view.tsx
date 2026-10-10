"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, CandidateAvatar, Checkbox, CriterionBar, EmptyState, Icon, LoadingRegion, PageHeader, Select, Skeleton, toneContainer } from "@/components/m3";
import { apiMessage, type CompareCell, type CompareMatrix, type CompareRow, type Suggestion } from "@/lib/api-ranking";
import { useCompare, useRankings, useRoles } from "@/lib/queries/ranking";
import { cn } from "@/lib/utils";
import { criterionPercent } from "./card-adapter";
import { IdentityHiddenChip, RevealButton } from "./candidate-summary-card";

export const parseIds = (raw: string | null): number[] =>
  Array.from(new Set((raw ?? "").split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 4);

/** Numeric cell -> 0-100 for bars, and a display string. */
export function cellDisplay(kind: CompareRow["kind"], v: number | null): { percent: number; text: string } | null {
  if (v == null) return null;
  if (kind === "criterion") return { percent: criterionPercent(v), text: `${v}/5` };
  if (kind === "claims") return { percent: 0, text: String(v) };
  return { percent: v, text: `${Math.round(v)}` };
}

function SuggestionBadge({ suggestion }: { suggestion: Suggestion | undefined }) {
  if (!suggestion?.label) return <span className="body-s text-on-surface-variant">No suggestion yet</span>;
  const tone = suggestion.label === "Strong yes" || suggestion.label === "Yes" ? "strong" : suggestion.label === "Lean no" ? "medium" : "weak";
  return (
    <span className="flex flex-col gap-1">
      <span className={cn("inline-flex h-6 w-fit items-center gap-1 rounded-sm px-2 label-m", toneContainer[tone])}>
        <Icon name="psychology" size={16} filled className="text-ai" />
        {suggestion.label}
      </span>
      <span className="label-s text-on-surface-variant">AI suggestion — final decision by your team</span>
    </span>
  );
}

function Cell({ row, cell }: { row: CompareRow; cell: CompareCell | undefined }) {
  const d = cell ? cellDisplay(row.kind, cell.value) : null;
  const best = !!cell && row.best_candidate_ids.includes(cell.candidate_id);
  if (!d) return <span className="body-m text-on-surface-variant">—</span>;
  return (
    <div className={cn("space-y-1 rounded-sm px-2 py-1", best && "bg-match-strong-container/60 ring-1 ring-match-strong")} data-best={best || undefined}>
      {row.kind === "claims" ? (
        <p className={cn("title-s tabular-nums", cell && cell.value ? "text-match-weak" : "text-on-surface")}>{d.text}</p>
      ) : (
        <CriterionBar label={d.text} value={d.percent} highlight={best} />
      )}
      {best && (
        <span className="inline-flex items-center gap-1 label-s text-on-match-strong-container">
          <Icon name="star" size={14} filled />
          Best
        </span>
      )}
      {cell && cell.evidence.length > 0 && (
        <details className="body-s text-on-surface-variant">
          <summary className="cursor-pointer label-m text-primary">Evidence</summary>
          {cell.evidence.map((q, i) => (
            <blockquote key={i} className="mt-1 border-s-2 border-outline ps-2" title={q}>
              “{q}”
            </blockquote>
          ))}
        </details>
      )}
    </div>
  );
}

export function CompareTable({ data }: { data: CompareMatrix }) {
  const cols = data.candidates;
  return (
    <div className="overflow-x-auto rounded-md border border-outline-variant">
      <table className="w-full min-w-[640px] border-collapse text-start">
        <thead>
          <tr className="border-b border-outline-variant align-top">
            <th scope="col" className="w-44 p-3 text-start label-m uppercase text-on-surface-variant">
              <span className="sr-only">Criterion</span>
            </th>
            {cols.map((c) => (
              <th key={c.id} scope="col" className="min-w-48 p-3 text-start font-normal" data-blind={c.blind || undefined}>
                <div className="flex items-center gap-2">
                  <CandidateAvatar name={c.name} initials={c.blind ? "?" : c.avatar} src={c.blind ? null : c.avatar_url} size="md" />
                  <div className="min-w-0">
                    <p className="truncate title-s text-on-surface">{c.name}</p>
                    {!c.blind && c.email && <p className="truncate body-s text-on-surface-variant">{c.email}</p>}
                  </div>
                </div>
                {c.blind && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <IdentityHiddenChip />
                    <RevealButton candidateId={c.id} name={c.name} />
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key} className="border-b border-outline-variant/60 align-top last:border-0">
              <th scope="row" className="p-3 text-start label-l font-medium text-on-surface">
                {row.label}
                {row.kind === "interview" && <span className="block label-s text-on-surface-variant">Interview</span>}
              </th>
              {cols.map((c) => (
                <td key={c.id} className="p-2">
                  <Cell row={row} cell={row.cells.find((x) => x.candidate_id === c.id)} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="align-top">
            <th scope="row" className="p-3 text-start label-l font-medium text-on-surface">
              AI suggestion
            </th>
            {cols.map((c) => (
              <td key={c.id} className="p-3">
                <SuggestionBadge suggestion={data.suggestions[String(c.id)]} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Picker({ initialRole }: { initialRole: number | null }) {
  const router = useRouter();
  const roles = useRoles();
  const [roleId, setRoleId] = React.useState<number | null>(initialRole);
  const [picked, setPicked] = React.useState<number[]>([]);
  const rankings = useRankings(roleId ?? 0, { limit: 200 }, false);
  const items = roleId ? (rankings.data?.items ?? []) : [];
  return (
    <div className="max-w-xl space-y-4">
      <Select
        label="Role"
        value={roleId ? String(roleId) : undefined}
        onValueChange={(v) => {
          setRoleId(Number(v));
          setPicked([]);
        }}
        options={(roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
      />
      {roleId && rankings.isLoading && <Skeleton className="h-32 rounded-md" />}
      {roleId && !rankings.isLoading && items.length < 2 && (
        <p className="body-m text-on-surface-variant">This role needs at least two ranked candidates to compare.</p>
      )}
      {items.length >= 2 && (
        <fieldset className="space-y-1">
          <legend className="label-l text-on-surface-variant">Pick 2–4 candidates ({picked.length} selected)</legend>
          {items.map((c) => (
            <Checkbox
              key={c.candidate.id}
              label={`${c.candidate.name}${c.resume_fit?.overall_score != null ? ` · ${Math.round(c.resume_fit.overall_score)}` : ""}`}
              checked={picked.includes(c.candidate.id)}
              disabled={picked.length >= 4 && !picked.includes(c.candidate.id)}
              onCheckedChange={(v) =>
                setPicked((p) => (v === true ? [...p, c.candidate.id] : p.filter((x) => x !== c.candidate.id)))
              }
            />
          ))}
        </fieldset>
      )}
      <Button
        icon="compare_arrows"
        disabled={!roleId || picked.length < 2}
        onClick={() => router.replace(`/compare?role=${roleId}&ids=${picked.join(",")}`)}
      >
        Compare
      </Button>
    </div>
  );
}

export function CompareView({ roleParam, idsParam }: { roleParam: string | null; idsParam: string | null }) {
  const roleId = Number(roleParam) > 0 ? Number(roleParam) : null;
  const ids = parseIds(idsParam);
  const ready = roleId != null && ids.length >= 2;
  const compare = useCompare(ready ? roleId : null, ids);

  return (
    <div className="space-y-4 p-4 medium:p-6">
      <PageHeader
        title="Compare candidates"
        subtitle="Side by side on the role rubric. The best score in each row is highlighted."
        actions={
          roleId ? (
            <Button asChild variant="text" icon="arrow_back">
              <Link href={`/roles/${roleId}?tab=ranking`}>Back to ranking</Link>
            </Button>
          ) : undefined
        }
      />
      {!ready ? (
        <Picker initialRole={roleId} />
      ) : compare.isLoading ? (
        <LoadingRegion label="Loading comparison" className="space-y-3">
          <Skeleton className="h-24 rounded-md" />
          <Skeleton className="h-64 rounded-md" />
        </LoadingRegion>
      ) : compare.isError || !compare.data ? (
        <EmptyState icon="error" title="Could not load comparison">
          {apiMessage(compare.error)}
        </EmptyState>
      ) : (
        <>
          <CompareTable data={compare.data} />
          <p className="label-s text-on-surface-variant">AI suggestion — final decision by your team</p>
        </>
      )}
    </div>
  );
}
