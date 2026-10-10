"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, ClaimCheckBadge, CriterionBar, Icon, LinearProgress, ScoreRing, Skeleton, useSnackbar, type ClaimStatus } from "@/components/m3";
import { formatTimestamp } from "@/components/m3/transcript-viewer";
import { ApiError } from "@/lib/api";
import type { ClaimCheck, InterviewAnalysis, InterviewKeyMoment } from "@/lib/api-interviews";
import { analysisErrorMessage, buildCitations, citationHref, normalizePoint } from "@/lib/interviews-logic";
import { useAnalysisStatus, useInterviewAnalysis, useRequestAnalysis } from "@/lib/queries/interviews";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export function CitationChips({ interviewId, segmentIds }: { interviewId: number | string | null; segmentIds: number[] | undefined }) {
  if (interviewId == null) return null;
  const cites = buildCitations(interviewId, segmentIds);
  if (cites.length === 0) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap gap-1 align-middle">
      {cites.map((c, i) => (
        <Link
          key={c.id}
          href={c.href}
          aria-label={`Open transcript segment ${c.id}`}
          className="focus-ring inline-flex h-6 items-center gap-0.5 rounded-sm bg-surface-container-highest px-2 label-s text-primary hover:underline"
        >
          <Icon name="format_quote" size={14} />[{i + 1}]
        </Link>
      ))}
    </span>
  );
}

function PointList({
  title,
  icon,
  tone,
  dot,
  points,
  interviewId,
}: {
  title: string;
  icon: "check_circle" | "warning";
  tone: string;
  dot: string;
  points: unknown[];
  interviewId: number | string | null;
}) {
  const items = points.map(normalizePoint).filter((p) => p.text);
  return (
    <div>
      <p className={cn("mb-2 flex items-center gap-1.5 label-l", tone)}>
        <Icon name={icon} size={18} filled />
        {title} ({items.length})
      </p>
      <ul className="space-y-1.5">
        {items.map((p, i) => (
          <li key={i} className="flex items-start gap-1.5 body-s text-on-surface-variant">
            <span className={cn("mt-1.5 size-1 shrink-0 rounded-full", dot)} />
            <span>
              {p.text}
              <CitationChips interviewId={interviewId} segmentIds={p.segment_ids} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT_FALLBACK: Record<string, ClaimStatus> = { low: "verified", medium: "unclear", high: "contradicted" };

export function claimStatus(c: ClaimCheck): ClaimStatus {
  if (c.verdict === "verified" || c.verdict === "unclear" || c.verdict === "contradicted") return c.verdict;
  return (c.severity && VERDICT_FALLBACK[c.severity]) || "unclear";
}

export function humanizeRecommendation(r: string): string {
  return r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Pure rendering of an analysis (used on the interview and candidate pages). */
export function AnalysisView({ analysis, interviewId }: { analysis: InterviewAnalysis; interviewId: number | string | null }) {
  const ivId = interviewId ?? analysis.interview_id;
  const aggregate = Math.round((analysis.technical_score + analysis.communication_score + analysis.confidence_score) / 3);
  const moments = analysis.key_moments.map((m): InterviewKeyMoment => (typeof m === "string" ? { moment: m, signal: "" } : m));
  return (
    <div className="space-y-4">
      <Card variant="outlined" className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing value={aggregate} size={80} label="Overall" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-ai">
              <Icon name="psychology" filled />
              <span className="label-l uppercase">AI analysis</span>
            </div>
            <p className="body-m text-on-surface-variant">{analysis.summary}</p>
          </div>
        </div>
        {analysis.hiring_recommendation && (
          <div className="rounded-md bg-ai-container p-4 text-on-ai-container">
            <p className="label-m uppercase">AI suggestion</p>
            <p className="title-m">{humanizeRecommendation(analysis.hiring_recommendation)}</p>
            <p className="label-s opacity-80">AI suggestion — final decision by your team</p>
          </div>
        )}
        <div className="grid gap-4 rounded-md bg-surface-container p-4 medium:grid-cols-3">
          <CriterionBar label="Technical" value={analysis.technical_score} />
          <CriterionBar label="Communication" value={analysis.communication_score} />
          <CriterionBar label="Confidence" value={analysis.confidence_score} />
        </div>
        <div className="grid gap-5 medium:grid-cols-2">
          <PointList title="Strengths" icon="check_circle" tone="text-match-strong" dot="bg-match-strong" points={analysis.strengths} interviewId={ivId} />
          <PointList title="Considerations" icon="warning" tone="text-match-medium" dot="bg-match-medium" points={analysis.weaknesses} interviewId={ivId} />
        </div>
      </Card>

      {moments.length > 0 && (
        <Card variant="outlined" className="p-5">
          <h3 className="mb-3 title-m">Key moments</h3>
          <ul className="space-y-2">
            {moments.map((m, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2.5 rounded-md bg-surface-container p-3 body-s">
                {m.timestamp_ms != null && ivId != null && m.segment_id != null ? (
                  <Link
                    href={citationHref(ivId, m.segment_id)}
                    className="focus-ring inline-flex h-6 items-center rounded-sm bg-primary-container px-2 label-m tabular-nums text-on-primary-container hover:underline"
                    aria-label={`Open transcript at ${formatTimestamp(m.timestamp_ms)}`}
                  >
                    {formatTimestamp(m.timestamp_ms)}
                  </Link>
                ) : null}
                <span className="min-w-0 flex-1 text-on-surface-variant">{m.moment}</span>
                {m.signal && <span className="inline-flex items-center rounded-xs bg-ai-container px-2 py-0.5 label-m text-on-ai-container">{m.signal}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {analysis.resume_alignment.length > 0 && (
        <Card variant="outlined" className="p-5">
          <h3 className="mb-3 title-m">Resume claim checks</h3>
          <ul className="space-y-3">
            {analysis.resume_alignment.map((c, i) => (
              <li key={i} className="rounded-md bg-surface-container p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 label-l">{c.claim}</p>
                  <ClaimCheckBadge status={claimStatus(c)} />
                </div>
                {c.resume_quote && (
                  <blockquote className="mt-2 border-s-2 border-outline-variant ps-3 body-s italic text-on-surface-variant">
                    &ldquo;{c.resume_quote}&rdquo;
                  </blockquote>
                )}
                <p className="mt-2 body-s text-on-surface-variant">
                  {c.result}
                  <CitationChips interviewId={ivId} segmentIds={c.segment_ids} />
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Run analysis -> poll status -> show result. */
export function AnalysisPanel({
  interviewId,
  analysisId,
  canEdit,
  hasTranscript,
}: {
  interviewId: number;
  analysisId: number | null;
  canEdit: boolean;
  hasTranscript: boolean;
}) {
  const status = useAnalysisStatus(interviewId);
  const state = status.data?.status ?? "none";
  const running = state === "queued" || state === "running";
  const result = useInterviewAnalysis(interviewId, analysisId != null || state === "completed");
  const run = useRequestAnalysis(interviewId);
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [error, setError] = React.useState<string | null>(null);
  const wasRunning = React.useRef(false);

  React.useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current && state === "completed") {
      wasRunning.current = false;
      snack.show("Analysis complete");
      void qc.invalidateQueries({ queryKey: ["interviews"] });
    } else if (wasRunning.current) wasRunning.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, running]);

  const trigger = () => {
    setError(null);
    wasRunning.current = true;
    run.mutate(undefined, {
      onError: (e) => {
        wasRunning.current = false;
        setError(e instanceof ApiError ? analysisErrorMessage(e.code, e.detail) : "Could not start analysis");
      },
    });
  };

  const failedText = state === "failed" ? analysisErrorMessage(status.data?.error ?? undefined, status.data?.error || "Analysis failed.") : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button
            variant={result.data ? "tonal" : "filled"}
            icon={result.data ? "refresh" : "psychology"}
            loading={running || run.isPending}
            disabled={!hasTranscript}
            onClick={trigger}
          >
            {running ? "Analysing…" : result.data ? "Re-run analysis" : "Run analysis"}
          </Button>
        )}
        {!hasTranscript && <span className="body-s text-on-surface-variant">{analysisErrorMessage("no_transcript", "")}</span>}
      </div>

      <div aria-live="polite" aria-atomic="true">
        {running && (
          <div role="status" className="space-y-2 rounded-md bg-surface-container p-4">
            <LinearProgress aria-label="Analysis in progress" />
            <p className="label-m text-on-surface-variant">{state === "running" ? "Analysing the interview…" : "Queued for analysis…"}</p>
          </div>
        )}
        {(error || failedText) && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-error-container p-4 text-on-error-container">
            <Icon name="error" filled />
            <p className="min-w-0 flex-1 body-s">{error ?? failedText}</p>
            {canEdit && !error && (
              <Button variant="outlined" size="sm" onClick={trigger}>
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      {result.isLoading && analysisId != null ? (
        <Skeleton className="h-64 rounded-md" />
      ) : result.data ? (
        <AnalysisView analysis={result.data} interviewId={interviewId} />
      ) : !running && !failedText && !error ? (
        <Card variant="outlined" className="border-dashed p-8 text-center">
          <Icon name="psychology" size={32} className="mx-auto mb-3 text-on-surface-variant" />
          <p className="body-m text-on-surface-variant">No analysis yet. Analysis needs the resume, a transcript and a speaker mapped to the candidate.</p>
        </Card>
      ) : null}
    </div>
  );
}
