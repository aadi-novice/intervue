"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CandidateAvatar,
  Dialog,
  DialogContent,
  EmptyState,
  Icon,
  LinearProgress,
  LoadingRegion,
  PageHeader,
  Skeleton,
  StaggerItem,
  scoreTone,
  toneText,
} from "@/components/m3";
import { BotToggleButton, PlatformIcon } from "@/components/interviews/bot-parts";
import { formatWhen } from "@/components/interviews/interviews-explorer";
import { ScheduleDialog } from "@/components/interviews/schedule-dialog";
import { humanizeRecommendation } from "@/components/interviews/analysis-panel";
import { RequireRole } from "@/components/require-role";
import { useDashboardSummary, useOrgId, useOrgUsage } from "@/lib/queries/interviews";
import { CAN, roleAllowed, useRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

function SectionCard({ title, icon, action, children }: { title: string; icon: "work" | "event" | "psychology"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card variant="outlined" className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 title-m">
          <Icon name={icon} className="text-on-surface-variant" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function UsageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const usage = useOrgUsage(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent icon="payments" title="AI usage this month" description={usage.data ? `Billing month ${usage.data.month}` : undefined}>
        {usage.isLoading ? (
          <LoadingRegion label="Loading usage" className="space-y-2">
            <Skeleton className="h-8 rounded-sm" />
            <Skeleton className="h-8 rounded-sm" />
          </LoadingRegion>
        ) : usage.isError ? (
          <p role="alert" className="body-m text-error">
            Couldn&apos;t load usage: {(usage.error as Error).message}
          </p>
        ) : usage.data && usage.data.by_purpose.length > 0 ? (
          <table className="w-full body-s">
            <caption className="sr-only">AI cost by purpose</caption>
            <thead>
              <tr className="text-start label-m text-on-surface-variant">
                <th scope="col" className="pb-2 text-start">Purpose</th>
                <th scope="col" className="pb-2 text-end">Runs</th>
                <th scope="col" className="pb-2 text-end">Tokens in/out</th>
                <th scope="col" className="pb-2 text-end">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.by_purpose.map((r) => (
                <tr key={r.purpose} className="border-t border-outline-variant">
                  <th scope="row" className="py-2 text-start font-normal capitalize">{r.purpose.replace(/_/g, " ")}</th>
                  <td className="py-2 text-end tabular-nums">{r.runs}</td>
                  <td className="py-2 text-end tabular-nums">{r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}</td>
                  <td className="py-2 text-end tabular-nums">{usd.format(r.cost_usd)}</td>
                </tr>
              ))}
              <tr className="border-t border-outline font-medium">
                <th scope="row" className="py-2 text-start">Total</th>
                <td colSpan={3} className="py-2 text-end tabular-nums">{usd.format(usage.data.total_usd)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="body-m text-on-surface-variant">No AI usage recorded this month.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const q = useDashboardSummary();
  const orgId = useOrgId();
  const role = useRole();
  const canEdit = roleAllowed(role, CAN.create);
  const [schedule, setSchedule] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const data = q.data;

  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Dashboard"
        subtitle="Your hiring pipeline at a glance."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outlined" icon="view_kanban" asChild>
              <Link href="/dashboard/pipeline">Pipeline</Link>
            </Button>
            <Button variant="outlined" icon="groups" asChild>
              <Link href="/dashboard/candidates">Candidates</Link>
            </Button>
            <RequireRole roles={CAN.create}>
              <Button icon="add_link" onClick={() => setSchedule(true)}>
                Schedule interview
              </Button>
            </RequireRole>
          </div>
        }
      />

      {q.isLoading ? (
        <LoadingRegion label="Loading dashboard" className="grid gap-4 large:grid-cols-2">
          <Skeleton className="h-64 rounded-md" />
          <Skeleton className="h-64 rounded-md" />
          <Skeleton className="h-64 rounded-md" />
        </LoadingRegion>
      ) : q.isError || !data ? (
        <p role="alert" className="body-m text-error">
          Couldn&apos;t load the dashboard. {(q.error as Error | null)?.message}
        </p>
      ) : (
        <div className="grid gap-4 large:grid-cols-2">
          <StaggerItem index={0}>
            <SectionCard title="Open roles" icon="work">
              {data.roles.length === 0 ? (
                <EmptyState icon="work" title="No roles yet">
                  Create a role to start ranking candidates.
                </EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.roles.map((r) => {
                    const pct = r.candidate_count > 0 ? Math.round((r.scored_count / r.candidate_count) * 100) : 0;
                    return (
                      <li key={r.id}>
                        <Link href={`/roles/${r.id}`} className="state-layer focus-ring relative block rounded-md bg-surface-container p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate title-s">{r.name}</span>
                            <span className="label-m text-on-surface-variant">
                              {r.avg_score != null && (
                                <span className={cn("me-2 font-medium tabular-nums", toneText[scoreTone(r.avg_score)])}>avg {Math.round(r.avg_score)}</span>
                              )}
                              {r.rank_status.replace(/_/g, " ")}
                            </span>
                          </div>
                          <LinearProgress value={pct} aria-label={`${r.name}: ${r.scored_count} of ${r.candidate_count} candidates ranked`} className="mt-2" />
                          <p className="mt-1 label-s text-on-surface-variant">
                            {r.scored_count} of {r.candidate_count} candidates ranked
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </StaggerItem>

          <StaggerItem index={1}>
            <SectionCard
              title="Upcoming interviews"
              icon="event"
              action={
                <Button variant="text" size="sm" asChild>
                  <Link href="/interviews">View all</Link>
                </Button>
              }
            >
              {data.upcoming_interviews.length === 0 ? (
                <EmptyState icon="event" title="Nothing scheduled">
                  Paste a meeting link to schedule an interview.
                </EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.upcoming_interviews.map((iv) => (
                    <li key={iv.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-container p-3">
                      <PlatformIcon platform={iv.platform} />
                      <Link href={`/interviews/${iv.id}`} className="focus-ring min-w-0 flex-1 rounded-xs">
                        <p className="truncate title-s">{iv.title}</p>
                        <p className="truncate body-s text-on-surface-variant">
                          {iv.candidate_name}
                          {iv.role_name ? ` · ${iv.role_name}` : ""} · {formatWhen(iv.scheduled_start)}
                        </p>
                      </Link>
                      <BotToggleButton interviewId={iv.id} platform={iv.platform} hasUrl={!!iv.meeting_url} botStatus={iv.bot_status} canEdit={canEdit} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </StaggerItem>

          <StaggerItem index={2}>
            <SectionCard title="Recent analyses" icon="psychology">
              {data.recent_analyses.length === 0 ? (
                <EmptyState icon="psychology" title="No analyses yet">
                  Completed interview analyses show up here.
                </EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.recent_analyses.map((a) => {
                    const name = a.candidate.blind ? "Candidate (identity hidden)" : a.candidate.name;
                    const href = a.interview_id ? `/interviews/${a.interview_id}?tab=analysis` : `/candidate/${a.candidate.id}`;
                    return (
                      <li key={a.analysis_id}>
                        <Link href={href} className="state-layer focus-ring relative flex items-center gap-3 rounded-md bg-surface-container p-3">
                          {a.candidate.blind ? (
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-container-highest text-on-surface-variant">
                              <Icon name="visibility_off" size={20} label="Identity hidden" />
                            </span>
                          ) : (
                            <CandidateAvatar name={a.candidate.name} initials={a.candidate.avatar} src={a.candidate.avatar_url} size="md" shape="rounded" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate title-s">{name}</p>
                            <p className="truncate body-s text-on-surface-variant">
                              {a.role_name ?? "No role"}
                              {a.recommendation ? ` · AI suggestion: ${humanizeRecommendation(a.recommendation)}` : ""}
                            </p>
                          </div>
                          <span className={cn("title-m tabular-nums", toneText[scoreTone(a.aggregate)])}>{a.aggregate}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </StaggerItem>

          {data.ai_cost_month_usd != null && orgId != null && (
            <StaggerItem index={3}>
              <Card variant="outlined" className="space-y-3 p-5">
                <h2 className="flex items-center gap-2 title-m">
                  <Icon name="payments" className="text-on-surface-variant" /> AI cost this month
                </h2>
                <p className="display-s tabular-nums">{usd.format(data.ai_cost_month_usd)}</p>
                <Button variant="tonal" size="sm" icon="receipt_long" onClick={() => setUsageOpen(true)}>
                  View breakdown
                </Button>
              </Card>
            </StaggerItem>
          )}
        </div>
      )}

      <ScheduleDialog open={schedule} onOpenChange={setSchedule} />
      <UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
    </div>
  );
}
