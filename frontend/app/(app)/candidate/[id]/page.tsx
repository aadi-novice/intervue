"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Button,
  CandidateAvatar,
  Card,
  EmptyState,
  Icon,
  LinearProgress,
  LoadingRegion,
  ScoreRing,
  Skeleton,
  StaggerItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  stageTone,
  type IconName,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import { api, type CandidateDetail } from "@/lib/api";
import type { InterviewAnalysis } from "@/lib/api-interviews";
import { CAN, roleAllowed, useRole } from "@/lib/roles";
import { RequireRole } from "@/components/require-role";
import { EraseCandidateAction } from "@/components/compliance/erase-candidate-dialog";
import { AnalysisView } from "@/components/interviews/analysis-panel";
import { InterviewRow } from "@/components/interviews/interviews-explorer";
import { ScheduleDialog } from "@/components/interviews/schedule-dialog";
import { SummaryCardPanel } from "@/components/ranking/summary-card-panel";
import { CandidateMatchesCard } from "@/components/ranking/candidate-matches-card";
import { useCandidateActivity, useInterviews } from "@/lib/queries/interviews";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { isParseFailed, isParsePending } from "@/lib/resume-parse";
import { ResumeParseFailedBanner } from "@/components/candidate/resume-parse-failed";
import { uploadErrorMessage } from "@/lib/interviews-logic";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Technical Interview",
  offer: "Offer Stage",
  hired: "Hired",
};

const PROGRESS: { event: string; icon: IconName; stages: string[] }[] = [
  { event: "Applied", icon: "description", stages: ["applied", "screening", "interview", "offer", "hired"] },
  { event: "Screening", icon: "psychology", stages: ["screening", "interview", "offer", "hired"] },
  { event: "Interview", icon: "target", stages: ["interview", "offer", "hired"] },
  { event: "Offer", icon: "bolt", stages: ["offer", "hired"] },
  { event: "Hired", icon: "check_circle", stages: ["hired"] },
];

const ACTION_LABELS: Record<string, string> = {
  "recording.accessed": "Recording played",
  "recording.uploaded": "Recording uploaded",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function Chip({ children, tone = "bg-primary-container text-on-primary-container" }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn("inline-flex items-center rounded-xs px-2 py-0.5 label-m", tone)}>{children}</span>;
}

function DetailSkeleton() {
  return (
    <LoadingRegion label="Loading candidate" className="space-y-4 p-4 medium:p-6">
      <Skeleton className="h-40 rounded-md" />
      <Skeleton className="h-10 w-2/3 rounded-md" />
      <Skeleton className="h-72 rounded-md" />
    </LoadingRegion>
  );
}

/** Legacy analyses (candidate-level) share the interview analysis shape closely enough to render. */
function toInterviewAnalysis(a: NonNullable<CandidateDetail["analysis"]>, candidateId: number): InterviewAnalysis {
  const x = a as unknown as Partial<InterviewAnalysis> & NonNullable<CandidateDetail["analysis"]>;
  return {
    id: x.id,
    summary: x.summary,
    strengths: x.strengths,
    weaknesses: x.weaknesses,
    technical_score: x.technical_score,
    communication_score: x.communication_score,
    confidence_score: x.confidence_score,
    key_moments: x.key_moments as InterviewAnalysis["key_moments"],
    resume_alignment: x.resume_alignment as InterviewAnalysis["resume_alignment"],
    candidate_id: candidateId,
    interview_id: x.interview_id ?? null,
    hiring_recommendation: x.hiring_recommendation ?? null,
    created_at: x.created_at,
  };
}

function ResumeProfile({ p }: { p: NonNullable<CandidateDetail["resume_profile"]> }) {
  const skillGroups = [
    ["Languages", p.skills.programming_languages, "bg-primary-container text-on-primary-container"],
    ["Frameworks", p.skills.frameworks, "bg-match-strong-container text-on-match-strong-container"],
    ["Tools", p.skills.tools, "bg-ai-container text-on-ai-container"],
    ["Databases", p.skills.databases, "bg-match-medium-container text-on-match-medium-container"],
  ] as const;
  return (
    <div className="space-y-5">
      {p.experience.length > 0 && (
        <section aria-label="Experience">
          <h3 className="mb-2 title-s">Experience</h3>
          <div className="space-y-3">
            {p.experience.map((w, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md bg-surface-container p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-container-highest label-l text-on-surface-variant">{w.company[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="title-s">{w.designation}</p>
                      <p className="body-s text-on-surface-variant">{w.company}</p>
                    </div>
                    <span className="whitespace-nowrap rounded-xs bg-surface-container-highest px-2 py-0.5 label-s tabular-nums text-on-surface-variant">
                      {w.start_date} – {w.is_current ? "Present" : w.end_date}
                    </span>
                  </div>
                  {w.technologies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {w.technologies.slice(0, 6).map((t) => (
                        <Chip key={t}>{t}</Chip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {p.education.length > 0 && (
        <section aria-label="Education">
          <h3 className="mb-2 title-s">Education</h3>
          <div className="space-y-2">
            {p.education.map((ed, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md bg-surface-container p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-match-strong-container text-on-match-strong-container">
                  <Icon name="school" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="title-s">
                    {ed.degree} · {ed.field_of_study}
                  </p>
                  <p className="body-s text-on-surface-variant">{ed.institution}</p>
                </div>
                <span className="shrink-0 label-s tabular-nums text-on-surface-variant">
                  {ed.start_date}–{ed.end_date}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {p.projects.length > 0 && (
        <section aria-label="Projects">
          <h3 className="mb-2 title-s">Projects</h3>
          <div className="space-y-2">
            {p.projects.map((proj, i) => (
              <div key={i} className="rounded-md bg-surface-container p-3">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="title-s">{proj.name}</p>
                  <div className="flex shrink-0 gap-1.5">
                    {proj.github && (
                      <a href={proj.github} target="_blank" rel="noreferrer" aria-label="Source code" className="focus-ring flex size-7 items-center justify-center rounded-xs bg-surface-container-highest text-on-surface-variant hover:text-on-surface">
                        <Icon name="fork_right" size={16} />
                      </a>
                    )}
                    {proj.live_link && (
                      <a href={proj.live_link} target="_blank" rel="noreferrer" aria-label="Live site" className="focus-ring flex size-7 items-center justify-center rounded-xs bg-surface-container-highest text-on-surface-variant hover:text-primary">
                        <Icon name="open_in_new" size={16} />
                      </a>
                    )}
                  </div>
                </div>
                <p className="body-s text-on-surface-variant">{proj.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {proj.technologies.slice(0, 6).map((t) => (
                    <Chip key={t} tone="bg-ai-container text-on-ai-container">
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {skillGroups.some(([, l]) => l && l.length > 0) && (
        <section aria-label="Skills" className="space-y-3">
          <h3 className="title-s">Skills</h3>
          {skillGroups.map(
            ([title, list, tone]) =>
              list &&
              list.length > 0 && (
                <div key={title}>
                  <p className="mb-1.5 label-l text-on-surface-variant">{title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((s) => (
                      <Chip key={s} tone={tone}>
                        {s}
                      </Chip>
                    ))}
                  </div>
                </div>
              ),
          )}
        </section>
      )}
    </div>
  );
}

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"resume" | "transcript" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const role = useRole();
  const canEdit = roleAllowed(role, CAN.create);
  const canSeeActivity = role != null && role !== "interviewer";

  const interviews = useInterviews({ candidate_id: Number(id) }, !!id);
  const activity = useCandidateActivity(id, canSeeActivity);

  const reload = () => {
    if (!id) return;
    api.candidates
      .get(id)
      .then(setCandidate)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!id) return;
    api.candidates
      .get(id)
      .then(setCandidate)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Resume parsing is async: poll the candidate while it is pending.
  const parsePending = isParsePending(candidate);
  const parseFailed = isParseFailed(candidate);
  useEffect(() => {
    if (!parsePending) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsePending, id]);

  const handleDeleteCandidate = async () => {
    if (!candidate) return;
    if (!confirm(`Permanently delete ${candidate.name}? This will remove all their data, analyses, and uploaded files.`)) return;
    setDeletingCandidate(true);
    try {
      await api.candidates.delete(candidate.id);
      router.push("/dashboard/candidates");
    } catch (err) {
      alert((err as Error).message);
      setDeletingCandidate(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (error || !candidate) {
    return (
      <div className="p-6">
        <p role="alert" className="body-m text-error">
          Error: {error ?? "Candidate not found"}
        </p>
        <Link href="/dashboard" className="mt-2 inline-block body-m text-primary hover:underline">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const p = candidate.resume_profile;
  const a = candidate.analysis;
  const stageLabel = STAGE_LABELS[candidate.stage] ?? candidate.stage;
  const ivList = interviews.data ?? [];

  const uploadResume = async (f: File) => {
    setUploading("resume");
    setUploadError(null);
    try {
      await api.candidates.uploadResume(candidate.id, f);
      reload();
    } catch (e) {
      setUploadError(e instanceof ApiError ? uploadErrorMessage(e.code, e.detail) : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  // Legacy endpoint: creates an "upload" interview and returns its id.
  const uploadTranscript = async (f: File) => {
    setUploading("transcript");
    setUploadError(null);
    try {
      const res = (await api.candidates.uploadTranscript(candidate.id, f)) as { interview_id?: number } | undefined;
      void qc.invalidateQueries({ queryKey: ["interviews"] });
      if (res?.interview_id) router.push(`/interviews/${res.interview_id}`);
      else reload();
    } catch (e) {
      setUploadError(e instanceof ApiError ? uploadErrorMessage(e.code, e.detail) : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const latestWithTranscript = ivList.find((i) => i.status !== "cancelled");
  const aIvId = (a as { interview_id?: number | null } | null)?.interview_id ?? null;
  const analysisInterviewId = aIvId ?? latestWithTranscript?.id ?? null;

  return (
    <div className="space-y-5 p-4 medium:p-6">
      <div className="flex flex-wrap items-center gap-2 body-m text-on-surface-variant">
        <Link href="/dashboard" className="focus-ring flex items-center gap-1 rounded-xs hover:text-on-surface">
          <Icon name="arrow_back" size={18} /> Dashboard
        </Link>
        <Icon name="chevron_right" size={18} />
        <span className="text-on-surface">{candidate.name}</span>
        <RequireRole roles={CAN.create}>
          <div className="ms-auto">
            <Button variant="outlined" size="sm" icon="delete" loading={deletingCandidate} onClick={handleDeleteCandidate} className="text-error">
              {deletingCandidate ? "Deleting…" : "Delete Candidate"}
            </Button>
          </div>
        </RequireRole>
      </div>

      <StaggerItem index={0}>
        <Card variant="filled" className="p-5">
          <div className="flex flex-wrap items-center gap-5">
            <label className="group relative shrink-0 cursor-pointer rounded-md focus-within:outline-3 focus-within:outline-secondary" title={canEdit ? "Click to change photo" : undefined}>
              <CandidateAvatar name={candidate.name} initials={candidate.avatar} src={candidate.avatar_url} size="lg" shape="rounded" />
              <span className="absolute inset-0 flex items-center justify-center rounded-md bg-scrim/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Icon name="upload" size={18} />
              </span>
              <input
                type="file"
                accept="image/*"
                disabled={!canEdit}
                className="sr-only"
                aria-label="Change photo"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await api.candidates.uploadAvatar(candidate.id, f);
                  reload();
                }}
              />
            </label>
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="truncate headline-s">{candidate.name}</h1>
              <p className="truncate body-m text-on-surface-variant">
                {p?.basics?.headline ?? candidate.role} · {candidate.role}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(candidate.stage).chip)}>{stageLabel}</span>
                {p && (
                  <span className="body-s text-on-surface-variant">
                    <span className="font-semibold text-on-surface tabular-nums">{p.metadata?.total_experience_years ?? "—"}</span> yrs exp
                  </span>
                )}
                <a href={`mailto:${candidate.email}`} className="focus-ring inline-flex items-center gap-1 rounded-xs body-s text-on-surface-variant hover:text-primary">
                  <Icon name="mail" size={16} /> {candidate.email}
                </a>
                {(candidate.phone ?? p?.basics?.phone) && (
                  <a href={`tel:${candidate.phone ?? p?.basics?.phone}`} className="focus-ring inline-flex items-center gap-1 rounded-xs body-s text-on-surface-variant hover:text-primary">
                    <Icon name="call" size={16} /> {candidate.phone ?? p?.basics?.phone}
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ScoreRing value={a?.aggregate_score ?? 0} size={72} tone={candidate.ai && a ? undefined : "none"} label="Match" />
            </div>
          </div>
        </Card>
      </StaggerItem>

      <Tabs defaultValue="overview">
        <TabsList variant="secondary">
          <TabsTrigger value="overview">
            <Icon name="dashboard" size={18} /> Overview
          </TabsTrigger>
          <TabsTrigger value="resume">
            <Icon name="description" size={18} /> Resume
          </TabsTrigger>
          <TabsTrigger value="interviews">
            <Icon name="event" size={18} /> Interviews ({ivList.length})
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <Icon name="psychology" size={18} /> Analysis
          </TabsTrigger>
          {canSeeActivity && (
            <TabsTrigger value="activity">
              <Icon name="history" size={18} /> Activity
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {parseFailed && <ResumeParseFailedBanner error={candidate.resume_parse_error} />}
          {parsePending && (
            <Card variant="outlined" className="space-y-3 p-5" role="status" aria-busy="true">
              <p className="label-l text-on-surface-variant">Parsing resume…</p>
              <LinearProgress aria-label="Parsing resume" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
              <Skeleton className="h-4 w-1/2 rounded-sm" />
            </Card>
          )}
          {p?.summary && (
            <Card variant="outlined" className="p-5">
              <h2 className="mb-2 title-m">Profile summary</h2>
              <p className="body-m text-on-surface-variant">{p.summary}</p>
            </Card>
          )}
          <SummaryCardPanel candidateId={candidate.id} roleId={candidate.role_id} />
          <CandidateMatchesCard candidateId={candidate.id} />
          <Card variant="outlined" className="p-5">
            <h2 className="mb-3 title-m">Pipeline progress</h2>
            <ol className="flex items-center gap-1">
              {PROGRESS.map((t, i, arr) => {
                const active = t.stages.includes(candidate.stage);
                const nextActive = arr[i + 1]?.stages.includes(candidate.stage);
                return (
                  <li key={t.event} className="flex flex-1 items-center gap-1" aria-current={active && !nextActive ? "step" : undefined}>
                    <span
                      title={t.event}
                      className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", active ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface-variant")}
                    >
                      <Icon name={t.icon} size={16} label={`${t.event}${active ? " (reached)" : ""}`} />
                    </span>
                    {i < arr.length - 1 && <span className={cn("h-0.5 flex-1 rounded", active && nextActive ? "bg-primary" : "bg-outline-variant")} />}
                  </li>
                );
              })}
            </ol>
            {candidate.days !== undefined && <p className="mt-3 text-center label-s text-on-surface-variant">Applied {candidate.days}d ago</p>}
          </Card>
        </TabsContent>

        <TabsContent value="resume" className="space-y-4 pt-4">
          {parseFailed && <ResumeParseFailedBanner error={candidate.resume_parse_error} />}
          <Card variant="outlined" className="space-y-3 p-5">
            <label className="state-layer relative flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-outline-variant p-3 focus-within:outline-3 focus-within:outline-secondary">
              {uploading === "resume" ? (
                <span className="animate-m3-spin size-5 rounded-full border-2 border-primary border-t-transparent" aria-label="Uploading" />
              ) : candidate.resume_path ? (
                <Icon name="check_circle" filled className="text-match-strong" />
              ) : (
                <Icon name="upload" className="text-on-surface-variant" />
              )}
              <div className="min-w-0 flex-1">
                <p className="label-l">{candidate.resume_path ? "Replace resume" : "Upload resume"}</p>
                <p className="truncate label-s text-on-surface-variant">{candidate.resume_path ? candidate.resume_path.split("/").pop() : "PDF"}</p>
              </div>
              <input
                type="file"
                accept=".pdf,.docx"
                disabled={!canEdit}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadResume(f);
                }}
              />
            </label>
            {uploadError && (
              <p role="alert" className="body-s text-error">
                {uploadError}
              </p>
            )}
            {candidate.resume_url && (
              <>
                <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-xs label-l text-primary hover:underline">
                  <Icon name="open_in_new" size={16} /> Open resume in a new tab
                </a>
                <iframe src={candidate.resume_url} title={`${candidate.name} resume`} className="h-[28rem] w-full rounded-md border border-outline-variant bg-surface" />
              </>
            )}
          </Card>
          {p ? (
            <Card variant="outlined" className="p-5">
              <ResumeProfile p={p} />
            </Card>
          ) : parsePending ? (
            <Card variant="outlined" className="space-y-3 p-5" role="status" aria-busy="true">
              <p className="label-l text-on-surface-variant">Parsing resume…</p>
              <LinearProgress aria-label="Parsing resume" />
            </Card>
          ) : (
            <Card variant="outlined" className="border-dashed">
              <EmptyState icon="description" title="No parsed resume yet">
                Upload a resume to see the parsed profile.
              </EmptyState>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="interviews" className="space-y-4 pt-4">
          <RequireRole roles={CAN.create}>
            <div className="flex flex-wrap gap-2">
              <Button icon="add_link" onClick={() => setSchedule(true)}>
                Schedule interview
              </Button>
              <label className="relative inline-flex">
                <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-outline px-6 label-l text-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-secondary">
                  <Icon name="upload_file" size={18} /> {uploading === "transcript" ? "Uploading…" : "Upload transcript"}
                </span>
                <input
                  type="file"
                  accept=".txt,.vtt,.srt,.docx"
                  className="sr-only"
                  disabled={uploading != null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadTranscript(f);
                  }}
                />
              </label>
            </div>
          </RequireRole>
          {uploadError && (
            <p role="alert" className="body-s text-error">
              {uploadError}
            </p>
          )}
          {interviews.isLoading ? (
            <Skeleton className="h-20 rounded-md" />
          ) : ivList.length === 0 ? (
            <Card variant="outlined" className="border-dashed">
              <EmptyState icon="event" title="No interviews yet">
                Schedule an interview or upload a transcript.
              </EmptyState>
            </Card>
          ) : (
            <ul className="space-y-2">
              {ivList.map((iv) => (
                <li key={iv.id}>
                  <InterviewRow iv={iv} showCandidate={false} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4 pt-4">
          {a ? (
            <>
              <AnalysisView analysis={toInterviewAnalysis(a, Number(candidate.id))} interviewId={aIvId} />
              {analysisInterviewId != null && (
                <Button variant="tonal" icon="open_in_new" asChild>
                  <Link href={`/interviews/${analysisInterviewId}?tab=analysis`}>Open in interview (re-run, citations)</Link>
                </Button>
              )}
            </>
          ) : (
            <Card variant="outlined" className="border-dashed p-8 text-center">
              <Icon name="psychology" size={32} className="mx-auto mb-3 text-on-surface-variant" />
              <p className="body-m text-on-surface-variant">
                No AI analysis yet. Analysis runs per interview and needs the resume, a transcript and a speaker mapped to the candidate.
              </p>
              {analysisInterviewId != null && (
                <Button className="mt-4" variant="tonal" asChild>
                  <Link href={`/interviews/${analysisInterviewId}?tab=analysis`}>Go to interview analysis</Link>
                </Button>
              )}
            </Card>
          )}
        </TabsContent>

        {canSeeActivity && (
          <TabsContent value="activity" className="pt-4">
            {activity.isLoading ? (
              <Skeleton className="h-32 rounded-md" />
            ) : activity.isError ? (
              <p role="alert" className="body-m text-on-surface-variant">
                Activity isn&apos;t available for your role.
              </p>
            ) : (activity.data ?? []).length === 0 ? (
              <Card variant="outlined" className="border-dashed">
                <EmptyState icon="history" title="No activity yet" />
              </Card>
            ) : (
              <ol className="space-y-3 border-s-2 border-outline-variant ps-4">
                {(activity.data ?? []).map((it) => (
                  <li key={it.id} className="relative">
                    <span aria-hidden className="absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full bg-primary" />
                    <p className="label-l">{actionLabel(it.action)}</p>
                    <p className="label-s text-on-surface-variant">
                      {it.user_name ?? "System"} · {new Date(it.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        )}
      </Tabs>

      <RequireRole roles={CAN.create}>
        <Card variant="outlined" className="flex flex-wrap items-center justify-between gap-3 border-error/40 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="title-m text-error">Danger zone</h2>
            <p className="body-s text-on-surface-variant">
              Erase all data permanently removes this candidate, their files, recordings, analyses and cached AI text,
              and returns a receipt. Use this for right-to-erasure requests.
            </p>
          </div>
          <EraseCandidateAction candidateId={candidate.id} candidateName={candidate.name} />
        </Card>
      </RequireRole>

      <ScheduleDialog open={schedule} onOpenChange={setSchedule} candidateId={Number(candidate.id)} />
    </div>
  );
}
