"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CandidateAvatar,
  CriterionBar,
  Icon,
  IconButton,
  PageHeader,
  Skeleton,
  LoadingRegion,
  StaggerItem,
  scoreTone,
  stageTone,
  toneText,
  type IconName,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import { api, type Role, type PipelineCandidate } from "@/lib/api";

const VELOCITY = [
  { day: "Mon", apps: 8, matches: 3 },
  { day: "Tue", apps: 14, matches: 5 },
  { day: "Wed", apps: 11, matches: 4 },
  { day: "Thu", apps: 19, matches: 7 },
  { day: "Fri", apps: 16, matches: 6 },
  { day: "Sat", apps: 5, matches: 2 },
  { day: "Sun", apps: 3, matches: 1 },
];

export default function DashboardPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      api.roles.list().then(setRoles).catch(() => {}),
      api.candidates.list().then(setCandidates).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`Delete "${role.name}"? This cannot be undone.`)) return;
    setDeletingId(role.id);
    try {
      await api.roles.delete(role.id);
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const totalCandidates = candidates.length;
  const aiMatches = candidates.filter((c) => c.ai && c.score >= 85).length;
  const totalRoles = roles.length;

  const candidatesByRole: Record<number, number> = {};
  candidates.forEach((c) => {
    candidatesByRole[c.role_id] = (candidatesByRole[c.role_id] ?? 0) + 1;
  });

  const scoreByRole: Record<number, number> = {};
  roles.forEach((r) => {
    const roleCands = candidates.filter((c) => c.role_id === r.id && c.score > 0);
    if (roleCands.length > 0) {
      scoreByRole[r.id] = Math.round(roleCands.reduce((s, c) => s + c.score, 0) / roleCands.length);
    }
  });

  const recentCandidates = [...candidates].slice(0, 4);
  const best = candidates.filter((c) => c.ai && c.score > 0).sort((a, b) => b.score - a.score)[0];

  const STATS: { label: string; value: string; sub: string; icon: IconName; tone: string }[] = [
    { label: "Active Roles", value: String(totalRoles), sub: "Across your workspace", icon: "work", tone: "bg-primary-container text-on-primary-container" },
    { label: "Total Candidates", value: String(totalCandidates), sub: "Across all roles", icon: "groups", tone: "bg-ai-container text-on-ai-container" },
    { label: "AI Matches", value: String(aiMatches), sub: "≥85% match score", icon: "bolt", tone: "bg-match-strong-container text-on-match-strong-container" },
    { label: "Avg. Time-to-Hire", value: "—", sub: "Calculated after first hire", icon: "schedule", tone: "bg-match-medium-container text-on-match-medium-container" },
  ];

  const maxApps = 19;

  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Dashboard"
        subtitle="AI Recruitment"
        actions={
          <span className="inline-flex h-8 items-center gap-2 rounded-sm bg-ai-container px-3 label-l text-on-ai-container">
            <Icon name="psychology" size={18} filled />
            AI Engine Active
          </span>
        }
      />

      {loading ? (
        <LoadingRegion label="Loading dashboard" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 expanded:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-md" />
            ))}
          </div>
          <div className="grid gap-4 expanded:grid-cols-5">
            <Skeleton className="h-80 rounded-md expanded:col-span-3" />
            <Skeleton className="h-80 rounded-md expanded:col-span-2" />
          </div>
        </LoadingRegion>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 expanded:grid-cols-4">
            {STATS.map((stat, i) => (
              <StaggerItem key={stat.label} index={i}>
                <Card variant="filled" className="p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <p className="label-m uppercase text-on-surface-variant">{stat.label}</p>
                    <span className={cn("flex size-8 items-center justify-center rounded-full", stat.tone)}>
                      <Icon name={stat.icon} size={18} />
                    </span>
                  </div>
                  <p className="display-s tabular-nums text-on-surface">{stat.value}</p>
                  <p className="mt-1 body-s text-on-surface-variant">{stat.sub}</p>
                </Card>
              </StaggerItem>
            ))}
          </div>

          <div className="grid gap-4 expanded:grid-cols-5">
            <Card variant="outlined" className="p-5 expanded:col-span-3">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="title-l">Active Roles</h2>
                <Button asChild variant="text" size="sm" trailingIcon="chevron_right">
                  <Link href="/roles/new">New Role</Link>
                </Button>
              </div>

              <div className="space-y-3">
                {roles.length === 0 && (
                  <p className="py-6 text-center body-m text-on-surface-variant">
                    No roles yet.{" "}
                    <Link href="/roles/new" className="text-primary hover:underline">
                      Post one →
                    </Link>
                  </p>
                )}
                {roles.map((role, i) => {
                  const count = candidatesByRole[role.id] ?? 0;
                  const aiScore = scoreByRole[role.id] ?? 0;
                  const daysOld = Math.floor((now - new Date(role.created_at).getTime()) / 86400000);
                  return (
                    <StaggerItem key={role.id} index={i}>
                      <div className="relative rounded-md bg-surface-container-low">
                        <Link
                          href="/dashboard/pipeline"
                          className="state-layer focus-ring block rounded-md p-4 pe-14"
                        >
                          <div className="mb-3 flex items-start justify-between">
                            <div className="min-w-0">
                              <p className="truncate title-m text-on-surface">{role.name}</p>
                              <p className="mt-0.5 body-s capitalize text-on-surface-variant">
                                {role.experience_level} · {role.experience_required_years}+ yrs
                              </p>
                            </div>
                            {aiScore > 0 && (
                              <div className="text-right">
                                <span className={cn("flex items-center gap-1 title-s tabular-nums", toneText[scoreTone(aiScore)])}>
                                  <Icon name="psychology" size={16} filled />
                                  {aiScore}%
                                </span>
                                <p className="label-s text-on-surface-variant">Avg Score</p>
                              </div>
                            )}
                          </div>
                          {aiScore > 0 && <CriterionBar label="Average score" value={aiScore} className="mb-3" />}
                          <div className="flex items-center justify-between">
                            <span className="inline-flex h-6 items-center rounded-sm bg-surface-container-highest px-2 label-m capitalize text-on-surface-variant">
                              {role.experience_level}
                            </span>
                            <div className="flex items-center gap-3 label-m text-on-surface-variant">
                              <span className="flex items-center gap-1">
                                <Icon name="groups" size={16} /> {count}
                              </span>
                              <span className="flex items-center gap-1">
                                <Icon name="target" size={16} className="text-match-strong" />
                                {candidates.filter((c) => c.role_id === role.id && c.ai).length} AI
                              </span>
                              <span className="flex items-center gap-1">
                                <Icon name="schedule" size={16} /> {daysOld}d
                              </span>
                            </div>
                          </div>
                        </Link>
                        <IconButton
                          icon="delete"
                          label={`Delete ${role.name}`}
                          size="sm"
                          className="absolute end-2 top-2 hover:text-error"
                          disabled={deletingId === role.id}
                          onClick={() => handleDeleteRole(role)}
                        />
                      </div>
                    </StaggerItem>
                  );
                })}
              </div>

              <Button asChild variant="outlined" className="mt-4 w-full">
                <Link href="/roles/new">Post New Role</Link>
              </Button>
            </Card>

            <div className="flex flex-col gap-4 expanded:col-span-2">
              <Card variant="filled" className="bg-ai-container p-5 text-on-ai-container">
                <div className="mb-3 flex items-center gap-2">
                  <Icon name="psychology" size={20} filled />
                  <span className="label-l uppercase">AI Insight</span>
                </div>
                {best ? (
                  <>
                    <p className="body-m">
                      <span className="font-semibold">{best.name}</span> has a{" "}
                      <span className="font-bold tabular-nums">{best.score}%</span> AI match for{" "}
                      <span className="font-semibold">{best.role}</span> — your top-ranked candidate right now.
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-on-ai-container/20 pt-3">
                      <span className="label-s">Live · AI Engine</span>
                      <Link href={`/candidate/${best.id}`} className="focus-ring flex items-center gap-1 label-l hover:underline">
                        View <Icon name="arrow_forward" size={16} />
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="body-m">Add candidates and run analysis to see AI insights.</p>
                )}
              </Card>

              <Card variant="outlined" className="flex-1 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="title-l">Recent Activity</h2>
                  <Button asChild variant="text" size="sm" trailingIcon="chevron_right">
                    <Link href="/dashboard/candidates">All</Link>
                  </Button>
                </div>
                {recentCandidates.length === 0 && (
                  <p className="py-6 text-center body-m text-on-surface-variant">
                    No candidates yet.{" "}
                    <Link href="/candidate/new" className="text-primary hover:underline">
                      Add one →
                    </Link>
                  </p>
                )}
                <ul className="space-y-1">
                  {recentCandidates.map((c, i) => (
                    <StaggerItem key={c.id} as="li" index={i}>
                      <Link
                        href={`/candidate/${c.id}`}
                        className="state-layer focus-ring relative flex items-center gap-3 rounded-md p-3"
                      >
                        <CandidateAvatar name={c.name} initials={c.avatar} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate title-s">{c.name}</p>
                            {c.ai && <Icon name="psychology" size={14} filled className="text-ai" label="AI analysed" />}
                          </div>
                          <p className="truncate body-s text-on-surface-variant">
                            {c.role} · <span className={stageTone(c.stage).text}>{c.stage}</span>
                          </p>
                        </div>
                        <span className={cn("title-s tabular-nums", toneText[scoreTone(c.score)])}>
                          {c.score > 0 ? `${c.score}%` : "—"}
                        </span>
                      </Link>
                    </StaggerItem>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          <Card variant="outlined" className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 title-l">
                <Icon name="trending_up" className="text-primary" />
                Hiring Velocity
              </h2>
              <span className="label-m text-on-surface-variant">Sample data</span>
            </div>
            <div className="flex gap-4" role="img" aria-label="Weekly applications and AI matches (sample data)">
              {VELOCITY.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-col justify-end gap-0.5" style={{ height: 80 }}>
                    <div className="w-full rounded-t-xs bg-ai" style={{ height: `${(d.matches / maxApps) * 100}%` }} />
                    <div
                      className="w-full rounded-t-xs bg-primary-container"
                      style={{ height: `${((d.apps - d.matches) / maxApps) * 100}%` }}
                    />
                  </div>
                  <span className="label-s text-on-surface-variant">{d.day}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 label-m text-on-surface-variant">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-xs bg-primary-container" /> Applications
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-xs bg-ai" /> AI Matches
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
