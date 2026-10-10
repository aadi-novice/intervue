"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Collapsible } from "radix-ui";
import {
  Button,
  CandidateAvatar,
  Card,
  ClaimCheckBadge,
  CriterionBar,
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
  type ClaimStatus,
  type IconName,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import { api, type CandidateDetail, type KeyMoment } from "@/lib/api";
import { CAN, roleAllowed, useRole } from "@/lib/roles";
import { RequireRole } from "@/components/require-role";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Technical Interview",
  offer: "Offer Stage",
  hired: "Hired",
};

/** Existing backend severity → claim-check status. */
const SEVERITY_STATUS: Record<string, ClaimStatus> = {
  low: "verified",
  medium: "unclear",
  high: "contradicted",
};

const PROGRESS: { event: string; icon: IconName; stages: string[] }[] = [
  { event: "Applied", icon: "description", stages: ["applied", "screening", "interview", "offer", "hired"] },
  { event: "Screening", icon: "psychology", stages: ["screening", "interview", "offer", "hired"] },
  { event: "Interview", icon: "target", stages: ["interview", "offer", "hired"] },
  { event: "Offer", icon: "bolt", stages: ["offer", "hired"] },
  { event: "Hired", icon: "check_circle", stages: ["hired"] },
];

function Chip({ children, tone = "bg-primary-container text-on-primary-container" }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn("inline-flex items-center rounded-xs px-2 py-0.5 label-m", tone)}>{children}</span>;
}

function DetailSkeleton() {
  return (
    <LoadingRegion label="Loading candidate" className="grid gap-5 p-4 medium:p-6 large:grid-cols-12">
      <div className="space-y-4 large:col-span-3">
        <Skeleton className="h-44 rounded-md" />
        <Skeleton className="h-32 rounded-md" />
        <Skeleton className="h-48 rounded-md" />
      </div>
      <div className="space-y-4 large:col-span-9">
        <Skeleton className="h-72 rounded-md" />
        <Skeleton className="h-64 rounded-md" />
      </div>
    </LoadingRegion>
  );
}

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"resume" | "transcript" | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisMsg, setAnalysisMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedFactCheck, setExpandedFactCheck] = useState<number | null>(null);
  const [showAllKeyMoments, setShowAllKeyMoments] = useState(false);
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  const router = useRouter();
  const canEdit = roleAllowed(useRole(), CAN.create);

  // Analysis is a background job (202): poll its status while queued/running.
  const statusQuery = useQuery({
    queryKey: ["analysis-status", id],
    queryFn: () => api.analysis.status(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "queued" || q.state.data?.status === "running" ? 2000 : false),
  });
  const jobStatus = statusQuery.data?.status;
  const analysisRunning = analysing || jobStatus === "queued" || jobStatus === "running";
  const wasRunning = useRef(false);

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

  // Job finished: pull the fresh analysis (and surface failures).
  useEffect(() => {
    if (jobStatus === "queued" || jobStatus === "running") {
      wasRunning.current = true;
    } else if (wasRunning.current && jobStatus === "completed") {
      wasRunning.current = false;
      setAnalysisMsg({ ok: true, text: "✓ Analysis complete" });
      reload();
    } else if (wasRunning.current && jobStatus === "failed") {
      wasRunning.current = false;
      setAnalysisMsg({ ok: false, text: statusQuery.data?.error || "Analysis failed" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus]);

  // Resume parsing is async too: poll the candidate while it is pending.
  const parsePending = candidate?.resume_parse_status === "pending";
  useEffect(() => {
    if (!parsePending) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsePending, id]);

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
  const aggregate = candidate.ai && a ? a.aggregate_score : 0;

  const allSkills = p
    ? [
        ...(p.skills.programming_languages ?? []),
        ...(p.skills.frameworks ?? []),
        ...(p.skills.tools ?? []),
        ...(p.skills.databases ?? []),
      ]
    : [];

  const stageLabel = STAGE_LABELS[candidate.stage] ?? candidate.stage;

  const severityCounts =
    a?.resume_alignment?.reduce(
      (acc, item) => {
        acc[item.severity] = (acc[item.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ) || {};

  const visibleKeyMoments = showAllKeyMoments ? a?.key_moments : a?.key_moments?.slice(0, 4);

  const fileRow = (
    kind: "resume" | "transcript",
    label: string,
    path: string | null,
    accept: string,
    hint: string,
    icon: IconName,
  ) => (
    <label className="state-layer relative flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-outline-variant p-3 focus-within:outline-3 focus-within:outline-secondary">
      {uploading === kind ? (
        <span className="animate-m3-spin size-5 rounded-full border-2 border-primary border-t-transparent" aria-label="Uploading" />
      ) : path ? (
        <Icon name="check_circle" filled className="text-match-strong" />
      ) : (
        <Icon name={icon} className="text-on-surface-variant" />
      )}
      <div className="min-w-0 flex-1">
        <p className="label-l">{path ? label : `Upload ${label}`}</p>
        <p className="truncate label-s text-on-surface-variant">{path ? path.split("/").pop() : hint}</p>
      </div>
      <input
        type="file"
        accept={accept}
        disabled={!canEdit}
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setUploading(kind);
          try {
            if (kind === "resume") await api.candidates.uploadResume(candidate.id, f);
            else await api.candidates.uploadTranscript(candidate.id, f);
            reload();
          } finally {
            setUploading(null);
          }
        }}
      />
    </label>
  );

  return (
    <div className="p-4 medium:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2 body-m text-on-surface-variant">
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

      <div className="grid grid-cols-1 gap-5 large:grid-cols-12">
        {/* LEFT SIDEBAR */}
        <div className="space-y-4 large:col-span-3">
          <StaggerItem index={0}>
            <Card variant="filled" className="p-5">
              <div className="flex items-center gap-3">
                <label className="group relative shrink-0 cursor-pointer rounded-md focus-within:outline-3 focus-within:outline-secondary" title={canEdit ? "Click to change photo" : undefined}>
                  <CandidateAvatar
                    name={candidate.name}
                    initials={candidate.avatar}
                    src={candidate.avatar_url}
                    size="lg"
                    shape="rounded"
                  />
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
                <div className="min-w-0 flex-1">
                  <h1 className="truncate title-l">{candidate.name}</h1>
                  <p className="truncate body-s text-on-surface-variant">{p?.basics?.headline ?? candidate.role}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(candidate.stage).chip)}>{stageLabel}</span>
                {parsePending && (
            <Card variant="outlined" className="space-y-3 p-5" role="status" aria-busy="true">
              <p className="label-l text-on-surface-variant">Parsing resume…</p>
              <LinearProgress aria-label="Parsing resume" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
              <Skeleton className="h-4 w-1/2 rounded-sm" />
              <Skeleton className="h-24 rounded-md" />
            </Card>
          )}

          {p && (
                  <span className="body-s text-on-surface-variant">
                    <span className="font-semibold text-on-surface tabular-nums">{p.metadata?.total_experience_years ?? "—"}</span> yrs exp
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-outline-variant pt-4">
                <a href={`mailto:${candidate.email}`} className="focus-ring flex items-center gap-2 rounded-xs body-s text-on-surface-variant hover:text-primary">
                  <Icon name="mail" size={18} />
                  <span className="truncate">{candidate.email}</span>
                </a>
                {(candidate.phone ?? p?.basics?.phone) && (
                  <a href={`tel:${candidate.phone ?? p?.basics?.phone}`} className="focus-ring flex items-center gap-2 rounded-xs body-s text-on-surface-variant hover:text-primary">
                    <Icon name="call" size={18} />
                    {candidate.phone ?? p?.basics?.phone}
                  </a>
                )}
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem index={1}>
            <Card variant="filled" className="p-5">
              <div className="mb-3 flex items-center gap-1.5 text-ai">
                <Icon name="psychology" size={18} filled />
                <span className="label-m uppercase">AI Match Score</span>
              </div>
              <div className="flex items-center gap-4">
                <ScoreRing value={a?.aggregate_score ?? 0} size={72} tone={candidate.ai && a ? undefined : "none"} />
                <div>
                  <p className="body-s text-on-surface-variant">For {candidate.role}</p>
                  {a ? (
                    <span className="mt-1.5 inline-flex rounded-xs bg-surface-container-highest px-2 py-0.5 label-m">
                      {aggregate >= 90 ? "Exceptional" : aggregate >= 80 ? "Strong" : "Moderate"}
                    </span>
                  ) : (
                    <span className="mt-1 block label-s text-on-surface-variant">No analysis yet</span>
                  )}
                </div>
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem index={2}>
            <Card variant="filled" className="p-5">
              <p className="mb-3 label-m uppercase text-on-surface-variant">Files &amp; Analysis</p>
              <div className="space-y-2">
                {fileRow("resume", "Resume", candidate.resume_path, ".pdf", "PDF", "upload")}
                {fileRow("transcript", "Transcript", candidate.transcript_path, ".txt", "TXT", "psychology")}
              </div>

              {analysisMsg && (
                <p role="status" className={cn("mt-2 text-center label-s", analysisMsg.ok ? "text-match-strong" : "text-error")}>
                  {analysisMsg.text}
                </p>
              )}
              {candidate.resume_url && (
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring mt-2 flex items-center justify-center gap-1 rounded-xs label-l text-primary hover:underline"
                >
                  <Icon name="open_in_new" size={16} /> Open resume
                </a>
              )}
              {analysisRunning && (
                <div className="mt-3 space-y-1" role="status">
                  <LinearProgress aria-label="Analysis in progress" />
                  <p className="text-center label-s text-on-surface-variant">
                    {jobStatus === "running" ? "Analysing…" : "Queued for analysis…"}
                  </p>
                </div>
              )}
              <RequireRole roles={CAN.create}>
                <Button
                  className="mt-3 w-full"
                  variant="tonal"
                  icon="refresh"
                  loading={analysisRunning}
                  disabled={!candidate.resume_path || !candidate.transcript_path}
                  onClick={async () => {
                    setAnalysing(true);
                    setAnalysisMsg(null);
                    try {
                      await api.candidates.triggerAnalysis(candidate.id);
                      wasRunning.current = true;
                      await statusQuery.refetch();
                    } catch (e) {
                      setAnalysisMsg({ ok: false, text: (e as Error).message || "Analysis failed" });
                    } finally {
                      setAnalysing(false);
                    }
                  }}
                >
                  {analysisRunning ? "Analysing…" : candidate.analysis ? "Re-run Analysis" : "Run AI Analysis"}
                </Button>
              </RequireRole>
              {canEdit && (!candidate.resume_path || !candidate.transcript_path) ? (
                <p className="mt-2 text-center label-s text-on-surface-variant">Upload both files to run analysis</p>
              ) : null}
            </Card>
          </StaggerItem>

          <StaggerItem index={3}>
            <Card variant="filled" className="p-5">
              <h2 className="mb-3 title-s">Pipeline Progress</h2>
              <ol className="flex items-center gap-1">
                {PROGRESS.map((t, i, arr) => {
                  const active = t.stages.includes(candidate.stage);
                  const nextActive = arr[i + 1]?.stages.includes(candidate.stage);
                  return (
                    <li key={t.event} className="flex flex-1 items-center gap-1" aria-current={active && !nextActive ? "step" : undefined}>
                      <span
                        title={t.event}
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full",
                          active ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface-variant",
                        )}
                      >
                        <Icon name={t.icon} size={16} label={`${t.event}${active ? " (reached)" : ""}`} />
                      </span>
                      {i < arr.length - 1 && <span className={cn("h-0.5 flex-1 rounded", active && nextActive ? "bg-primary" : "bg-outline-variant")} />}
                    </li>
                  );
                })}
              </ol>
              {candidate.days !== undefined && (
                <p className="mt-3 text-center label-s text-on-surface-variant">Applied {candidate.days}d ago</p>
              )}
            </Card>
          </StaggerItem>
        </div>

        {/* MAIN CONTENT */}
        <div className="space-y-4 large:col-span-9">
          {a ? (
            <StaggerItem index={0}>
              <Card variant="outlined" className="p-5">
                <div className="mb-4 flex items-center gap-2 text-ai">
                  <Icon name="psychology" filled />
                  <span className="label-l uppercase">AI Insight Module</span>
                </div>
                <p className="mb-5 body-m text-on-surface-variant">{a.summary}</p>

                <div className="grid gap-4 rounded-md bg-surface-container p-4 medium:grid-cols-3">
                  <CriterionBar label="Technical" value={a.technical_score} />
                  <CriterionBar label="Communication" value={a.communication_score} />
                  <CriterionBar label="Confidence" value={a.confidence_score} />
                </div>

                {(a.strengths.length > 0 || a.weaknesses.length > 0) && (
                  <div className="mt-5 grid gap-4 medium:grid-cols-2">
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 label-l text-match-strong">
                        <Icon name="check_circle" size={18} filled />
                        Strengths ({a.strengths.length})
                      </p>
                      <ul className="max-h-32 space-y-1.5 overflow-y-auto pe-2">
                        {(a.strengths as string[]).map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 body-s text-on-surface-variant">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-match-strong" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 label-l text-match-medium">
                        <Icon name="warning" size={18} filled />
                        Considerations ({a.weaknesses.length})
                      </p>
                      <ul className="max-h-32 space-y-1.5 overflow-y-auto pe-2">
                        {(a.weaknesses as string[]).map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 body-s text-on-surface-variant">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-match-medium" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>
            </StaggerItem>
          ) : (
            <Card variant="outlined" className="border-dashed p-8 text-center">
              <Icon name="psychology" size={32} className="mx-auto mb-3 text-on-surface-variant" />
              <p className="body-m text-on-surface-variant">No AI analysis yet. Upload resume + transcript and run analysis.</p>
            </Card>
          )}

          {a && (a.key_moments?.length > 0 || a.resume_alignment?.length > 0) && (
            <StaggerItem index={1}>
              <Card variant="outlined" className="p-2">
                <Tabs defaultValue="key-moments">
                  <TabsList variant="secondary">
                    <TabsTrigger value="key-moments">
                      <Icon name="schedule" size={18} /> Key Moments ({a.key_moments?.length || 0})
                    </TabsTrigger>
                    <TabsTrigger value="fact-check">
                      <Icon name="target" size={18} /> Fact Check ({a.resume_alignment?.length || 0})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="key-moments" className="p-3">
                    {a.key_moments && a.key_moments.length > 0 && (
                      <div>
                        <ul className="space-y-2">
                          {visibleKeyMoments?.map((km, i) => {
                            const isObj = typeof km === "object" && km !== null;
                            const momentText = isObj ? (km as KeyMoment).moment : (km as string);
                            const signalText = isObj ? (km as KeyMoment).signal : null;
                            return (
                              <li key={i} className="flex items-start gap-2.5 rounded-md bg-surface-container p-2.5 body-m">
                                <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-primary-container label-s text-on-primary-container">
                                  {i + 1}
                                </span>
                                <span className="flex-1 text-on-surface-variant">
                                  {momentText}
                                  {signalText && <Chip>{signalText}</Chip>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {a.key_moments.length > 4 && (
                          <Button variant="text" className="mt-3 w-full" trailingIcon={showAllKeyMoments ? "keyboard_arrow_up" : "keyboard_arrow_down"} onClick={() => setShowAllKeyMoments(!showAllKeyMoments)}>
                            {showAllKeyMoments ? "Show less" : `Show ${a.key_moments.length - 4} more`}
                          </Button>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="fact-check" className="p-3">
                    {a.resume_alignment && a.resume_alignment.length > 0 && (
                      <div>
                        <div className="mb-4 flex flex-wrap items-center gap-3 label-m">
                          {severityCounts.high > 0 && <span className="flex items-center gap-1 text-match-weak"><Icon name="error" size={16} filled /> {severityCounts.high} high</span>}
                          {severityCounts.medium > 0 && <span className="flex items-center gap-1 text-match-medium"><Icon name="warning" size={16} filled /> {severityCounts.medium} medium</span>}
                          {severityCounts.low > 0 && <span className="flex items-center gap-1 text-match-strong"><Icon name="check_circle" size={16} filled /> {severityCounts.low} low</span>}
                        </div>
                        <div className="max-h-[300px] space-y-2 overflow-y-auto pe-2">
                          {a.resume_alignment.map((item, i) => (
                            <Collapsible.Root key={i} open={expandedFactCheck === i} onOpenChange={(open) => setExpandedFactCheck(open ? i : null)}>
                              <Collapsible.Trigger className="state-layer focus-ring relative flex w-full items-start gap-3 rounded-md bg-surface-container p-3 text-left">
                                <p className="line-clamp-2 min-w-0 flex-1 label-m text-on-surface">&ldquo;{item.claim}&rdquo;</p>
                                <span className="flex shrink-0 items-center gap-2">
                                  <ClaimCheckBadge status={SEVERITY_STATUS[item.severity] ?? "unclear"} />
                                  <Icon name="keyboard_arrow_down" className={cn("transition-transform", expandedFactCheck === i && "rotate-180")} />
                                </span>
                              </Collapsible.Trigger>
                              <Collapsible.Content className="px-3 pb-3 pt-2 body-s text-on-surface-variant">{item.result}</Collapsible.Content>
                            </Collapsible.Root>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </Card>
            </StaggerItem>
          )}

          {p && (
            <StaggerItem index={2}>
              <Card variant="outlined" className="p-2">
                <Tabs defaultValue={p.experience.length > 0 ? "experience" : p.education.length > 0 ? "education" : p.projects.length > 0 ? "projects" : "skills"}>
                  <TabsList variant="secondary">
                    {p.experience.length > 0 && <TabsTrigger value="experience"><Icon name="work" size={18} /> Experience ({p.experience.length})</TabsTrigger>}
                    {p.education.length > 0 && <TabsTrigger value="education"><Icon name="school" size={18} /> Education ({p.education.length})</TabsTrigger>}
                    {p.projects.length > 0 && <TabsTrigger value="projects"><Icon name="folder" size={18} /> Projects ({p.projects.length})</TabsTrigger>}
                    {allSkills.length > 0 && <TabsTrigger value="skills"><Icon name="bolt" size={18} /> Skills ({allSkills.length})</TabsTrigger>}
                  </TabsList>

                  <TabsContent value="experience" className="p-3">
                    {p.summary && <p className="mb-4 rounded-md bg-surface-container p-3 body-m text-on-surface-variant">{p.summary}</p>}
                    <div className="max-h-[280px] space-y-3 overflow-y-auto pe-2">
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
                                {w.technologies.slice(0, 5).map((t) => <Chip key={t}>{t}</Chip>)}
                                {w.technologies.length > 5 && <Chip tone="bg-surface-container-highest text-on-surface-variant">+{w.technologies.length - 5}</Chip>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="education" className="space-y-3 p-3">
                    {p.education.map((ed, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-md bg-surface-container p-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-match-strong-container text-on-match-strong-container">
                          <Icon name="school" size={20} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="title-s">{ed.degree} · {ed.field_of_study}</p>
                          <p className="body-s text-on-surface-variant">{ed.institution}</p>
                        </div>
                        <span className="shrink-0 rounded-xs bg-surface-container-highest px-2 py-0.5 label-s tabular-nums text-on-surface-variant">{ed.start_date}–{ed.end_date}</span>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="projects" className="p-3">
                    <div className="max-h-[280px] space-y-3 overflow-y-auto pe-2">
                      {p.projects.map((proj, i) => (
                        <div key={i} className="rounded-md bg-surface-container p-3">
                          <div className="mb-1.5 flex items-start justify-between gap-2">
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
                            {proj.technologies.slice(0, 5).map((t) => <Chip key={t} tone="bg-ai-container text-on-ai-container">{t}</Chip>)}
                            {proj.technologies.length > 5 && <Chip tone="bg-surface-container-highest text-on-surface-variant">+{proj.technologies.length - 5}</Chip>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="skills" className="space-y-4 p-3">
                    {(
                      [
                        ["Languages", p.skills.programming_languages, "bg-primary-container text-on-primary-container"],
                        ["Frameworks", p.skills.frameworks, "bg-match-strong-container text-on-match-strong-container"],
                        ["Tools", p.skills.tools, "bg-ai-container text-on-ai-container"],
                        ["Databases", p.skills.databases, "bg-match-medium-container text-on-match-medium-container"],
                      ] as const
                    ).map(
                      ([title, list, tone]) =>
                        list &&
                        list.length > 0 && (
                          <div key={title}>
                            <p className="mb-2 label-l text-on-surface-variant">{title}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {list.map((s) => <Chip key={s} tone={tone}>{s}</Chip>)}
                            </div>
                          </div>
                        ),
                    )}
                  </TabsContent>
                </Tabs>
              </Card>
            </StaggerItem>
          )}
        </div>
      </div>
    </div>
  );
}
