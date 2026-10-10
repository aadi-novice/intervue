"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Button,
  CandidateAvatar,
  Card,
  CriterionBar,
  Dialog,
  DialogContent,
  EmptyState,
  FilterChip,
  Icon,
  LoadingRegion,
  PageHeader,
  Skeleton,
  StaggerItem,
  stageTone,
  type IconName,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import { api, type Role, type PipelineCandidate, type CandidateDetail } from "@/lib/api";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

function scoreToRec(score: number): "strong_hire" | "hire" | "consider" | "no_hire" {
  if (score >= 90) return "strong_hire";
  if (score >= 80) return "hire";
  if (score >= 65) return "consider";
  return "no_hire";
}

const REC_CONFIG: Record<string, { label: string; className: string; icon: IconName }> = {
  strong_hire: { label: "Strong Hire", className: "text-match-strong", icon: "trending_up" },
  hire: { label: "Hire", className: "text-primary", icon: "trending_up" },
  consider: { label: "Consider", className: "text-match-medium", icon: "remove" },
  no_hire: { label: "No Hire", className: "text-match-weak", icon: "trending_down" },
};

const METRICS = [
  { key: "aggregate_score", label: "AI Match Score" },
  { key: "technical_score", label: "Technical Depth" },
  { key: "communication_score", label: "Communication" },
  { key: "confidence_score", label: "Confidence" },
];

const rowGrid = "grid grid-cols-[96px_repeat(2,minmax(0,1fr))] gap-4 medium:grid-cols-[160px_repeat(2,minmax(0,1fr))]";

function MetricRow({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(...values.filter((v) => v > 0));
  return (
    <div className={cn(rowGrid, "items-center border-b border-outline-variant/50 py-3 last:border-0")}>
      <div className="label-m text-on-surface-variant">{label}</div>
      {values.map((v, i) => (
        <div key={i} className="relative">
          <CriterionBar label={label} value={v} highlight={v === max && v > 0} tone={v > 0 && v < max ? "none" : undefined} />
          {v === max && v > 0 && values.filter((x) => x === max).length === 1 && (
            <span className="absolute -top-1 right-0 label-s uppercase text-match-strong">Best</span>
          )}
        </div>
      ))}
    </div>
  );
}

function CandidateSelector({
  roleId,
  roleCandidates,
  selected,
  slot,
  onSelect,
  onClose,
}: {
  slot: 0 | 1;
  roleId: number | null;
  roleCandidates: PipelineCandidate[];
  selected: [string | null, string | null];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const otherSelected = selected[slot === 0 ? 1 : 0];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={roleId ? "Select candidate" : "Select a role first"} className="max-w-sm">
        {roleCandidates.length === 0 && roleId && (
          <p className="body-s text-on-surface-variant">No candidates for this role yet.</p>
        )}
        <ul className="space-y-1">
          {roleCandidates
            .filter((c) => c.id !== otherSelected)
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(c.id);
                    onClose();
                  }}
                  className="state-layer focus-ring relative flex w-full items-center gap-3 rounded-md p-3 text-left"
                >
                  <CandidateAvatar name={c.name} initials={c.avatar} size="sm" />
                  <div>
                    <p className="title-s">{c.name}</p>
                    <p className="body-s text-on-surface-variant">
                      {STAGE_LABELS[c.stage] ?? c.stage} · {c.score > 0 ? `${c.score}%` : "no score"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default function ComparePage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [allCandidates, setAllCandidates] = useState<PipelineCandidate[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selected, setSelected] = useState<[string | null, string | null]>([null, null]);
  const [details, setDetails] = useState<[CandidateDetail | null, CandidateDetail | null]>([null, null]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectorSlot, setSelectorSlot] = useState<0 | 1 | null>(null);

  useEffect(() => {
    api.roles.list().then(setRoles).catch(() => {});
    api.candidates.list().then(setAllCandidates).catch(() => {});
  }, []);

  const roleCandidates = selectedRoleId ? allCandidates.filter((c) => c.role_id === selectedRoleId) : [];

  const handleSelect = async (slot: 0 | 1, id: string) => {
    const next: [string | null, string | null] = [...selected] as [string | null, string | null];
    next[slot] = id;
    setSelected(next);

    setLoadingDetails(true);
    const fetched = await Promise.all(next.map((cid) => (cid ? api.candidates.get(cid).catch(() => null) : Promise.resolve(null))));
    setDetails(fetched as [CandidateDetail | null, CandidateDetail | null]);
    setLoadingDetails(false);
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const comparisonReady = details[0] && details[1];

  const metricVal = (d: CandidateDetail | null, key: string): number => {
    if (!d?.analysis) return 0;
    return (d.analysis as unknown as Record<string, number>)[key] ?? 0;
  };

  return (
    <div className="space-y-4 p-4 medium:p-6">
      <PageHeader
        title="Comparison Matrix"
        subtitle="Compare two candidates for the same role"
        actions={
          <span className="inline-flex h-8 items-center gap-2 rounded-sm bg-ai-container px-3 label-l text-on-ai-container">
            <Icon name="psychology" size={18} filled />
            AI-Powered Comparison
          </span>
        }
      />

      <Card variant="outlined" className="p-5">
        <p className="mb-3 label-m uppercase text-on-surface-variant">Step 1 — Select role to compare within</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Role">
          {roles.map((r) => (
            <FilterChip
              key={r.id}
              label={r.name}
              selected={selectedRoleId === r.id}
              onSelectedChange={() => {
                setSelectedRoleId(r.id);
                setSelected([null, null]);
                setDetails([null, null]);
              }}
            />
          ))}
          {roles.length === 0 && (
            <p className="body-m text-on-surface-variant">
              No roles yet —{" "}
              <Link href="/roles/new" className="text-primary hover:underline">
                post one
              </Link>
              .
            </p>
          )}
        </div>
      </Card>

      {selectedRoleId && (
        <Card variant="outlined" className="p-5">
          <p className="mb-3 label-m uppercase text-on-surface-variant">
            Step 2 — Choose two candidates from <span className="text-on-surface">{selectedRole?.name}</span> ({roleCandidates.length} available)
          </p>
          <div className="flex flex-col gap-4 medium:flex-row">
            {([0, 1] as const).map((slot) => {
              const selId = selected[slot];
              const c = selId ? allCandidates.find((x) => x.id === selId) : null;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectorSlot(slot)}
                  className={cn(
                    "state-layer focus-ring relative flex flex-1 items-center gap-3 rounded-md border-2 border-dashed p-4 text-left",
                    c ? "border-primary bg-primary-container/30" : "border-outline-variant",
                  )}
                >
                  {c ? (
                    <>
                      <CandidateAvatar name={c.name} initials={c.avatar} size="lg" />
                      <div>
                        <p className="title-s">{c.name}</p>
                        <p className="body-s text-on-surface-variant">{STAGE_LABELS[c.stage] ?? c.stage}</p>
                      </div>
                      <Icon name="check_box" filled className="ms-auto text-primary" />
                    </>
                  ) : (
                    <>
                      <span className="flex size-12 items-center justify-center rounded-full bg-surface-container-highest">
                        <Icon name="groups" className="text-on-surface-variant" />
                      </span>
                      <p className="body-m text-on-surface-variant">Candidate {slot + 1} — click to pick</p>
                      <Icon name="check_box_outline_blank" className="ms-auto text-outline" />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {selectorSlot !== null && (
        <CandidateSelector
          slot={selectorSlot}
          roleId={selectedRoleId}
          roleCandidates={roleCandidates}
          selected={selected}
          onSelect={(id) => handleSelect(selectorSlot, id)}
          onClose={() => setSelectorSlot(null)}
        />
      )}

      {loadingDetails && (
        <LoadingRegion label="Loading candidate profiles">
          <Skeleton className="h-96 rounded-md" />
        </LoadingRegion>
      )}

      {!loadingDetails &&
        comparisonReady &&
        (() => {
          const candidates = details as [CandidateDetail, CandidateDetail];
          return (
            <StaggerItem index={0}>
              <Card variant="outlined" className="p-4 medium:p-6">
                <div className={cn(rowGrid, "mb-6")}>
                  <div className="pt-4 label-m uppercase text-on-surface-variant">{selectedRole?.name}</div>
                  {candidates.map((c) => {
                    const rec = REC_CONFIG[scoreToRec(c.analysis?.aggregate_score ?? 0)];
                    return (
                      <div key={c.id} className="text-center">
                        <Link href={`/candidate/${c.id}`} className="focus-ring inline-block rounded-md">
                          <CandidateAvatar name={c.name} initials={c.avatar} size="lg" shape="rounded" className="mx-auto mb-2" />
                          <p className="title-s hover:text-primary">{c.name}</p>
                        </Link>
                        <p className="mt-0.5 body-s text-on-surface-variant">{c.resume_profile?.basics?.headline ?? c.role}</p>
                        <div className={cn("mt-2 flex items-center justify-center gap-1.5", rec.className)}>
                          <Icon name={rec.icon} size={16} />
                          <span className="label-m uppercase">{rec.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {METRICS.map((m) => (
                  <MetricRow key={m.key} label={m.label} values={candidates.map((c) => metricVal(c, m.key))} />
                ))}

                <div className="mt-6">
                  <div className={cn(rowGrid, "border-b border-outline-variant/50 py-3")}>
                    <div className="label-m text-on-surface-variant">Stage</div>
                    {candidates.map((c) => (
                      <div key={c.id} className="text-center">
                        <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(c.stage).chip)}>
                          {STAGE_LABELS[c.stage] ?? c.stage}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className={cn(rowGrid, "border-b border-outline-variant/50 py-3")}>
                    <div className="label-m text-on-surface-variant">Experience</div>
                    {candidates.map((c) => (
                      <div key={c.id} className="text-center title-s tabular-nums">
                        {c.resume_profile?.metadata?.total_experience_years != null ? `${c.resume_profile.metadata.total_experience_years} yrs` : "—"}
                      </div>
                    ))}
                  </div>

                  <div className={cn(rowGrid, "border-b border-outline-variant/50 py-3")}>
                    <div className="label-m text-on-surface-variant">Education</div>
                    {candidates.map((c) => {
                      const ed = c.resume_profile?.education?.[0];
                      return (
                        <div key={c.id} className="text-center body-s text-on-surface-variant">
                          {ed ? `${ed.degree}, ${ed.institution}` : "—"}
                        </div>
                      );
                    })}
                  </div>

                  <div className={cn(rowGrid, "border-b border-outline-variant/50 py-3")}>
                    <div className="label-m text-on-surface-variant">Top Skills</div>
                    {candidates.map((c) => {
                      const sk = c.resume_profile?.skills;
                      const tags = sk ? [...(sk.programming_languages ?? []), ...(sk.frameworks ?? [])].slice(0, 4) : [];
                      return (
                        <div key={c.id} className="flex flex-wrap justify-center gap-1">
                          {tags.length > 0 ? (
                            tags.map((s) => (
                              <span key={s} className="rounded-xs bg-surface-container-highest px-2 py-0.5 label-s text-on-surface-variant">
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="body-s text-on-surface-variant">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={cn(rowGrid, "border-b border-outline-variant/50 py-3")}>
                    <div className="label-m text-on-surface-variant">Strengths</div>
                    {candidates.map((c) => (
                      <ul key={c.id} className="space-y-1">
                        {((c.analysis?.strengths ?? []) as string[]).slice(0, 3).map((p, i) => (
                          <li key={i} className="flex items-start gap-1.5 body-s text-on-surface-variant">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-match-strong" />
                            {p}
                          </li>
                        ))}
                        {!c.analysis && <li className="body-s text-on-surface-variant">No analysis yet</li>}
                      </ul>
                    ))}
                  </div>

                  <div className={cn(rowGrid, "py-3")}>
                    <div className="label-m text-on-surface-variant">Considerations</div>
                    {candidates.map((c) => (
                      <ul key={c.id} className="space-y-1">
                        {((c.analysis?.weaknesses ?? []) as string[]).slice(0, 3).map((p, i) => (
                          <li key={i} className="flex items-start gap-1.5 body-s text-on-surface-variant">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-match-medium" />
                            {p}
                          </li>
                        ))}
                        {!c.analysis && <li className="body-s text-on-surface-variant">—</li>}
                      </ul>
                    ))}
                  </div>
                </div>

                <div className={cn(rowGrid, "mt-6 border-t border-outline-variant pt-5")}>
                  <div />
                  {candidates.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2">
                      <Button asChild variant="tonal" size="sm">
                        <Link href={`/candidate/${c.id}`}>View Profile</Link>
                      </Button>
                      {(c.analysis?.aggregate_score ?? 0) >= 90 && (
                        <Button size="sm" type="button">
                          Send Offer
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </StaggerItem>
          );
        })()}

      {!loadingDetails && !comparisonReady && selectedRoleId && (
        <EmptyState icon="groups" title="Select two candidates above to see their comparison matrix." />
      )}
    </div>
  );
}
