"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, Icon, LoadingRegion, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, AudioPlayer, type AudioPlayerHandle } from "@/components/m3";
import { AnalysisPanel } from "@/components/interviews/analysis-panel";
import { BotControls, InterviewStatusChip, PlatformIcon, platformLabel } from "@/components/interviews/bot-parts";
import { formatWhen } from "@/components/interviews/interviews-explorer";
import { NotesPanel } from "@/components/interviews/notes-panel";
import { SpeakerMapping } from "@/components/interviews/speaker-mapping";
import { TranscriptPane } from "@/components/interviews/transcript-pane";
import { UploadPanel } from "@/components/interviews/upload-panel";
import { ApiError } from "@/lib/api";
import { failureMessage, isBotActive, parseSegmentTarget } from "@/lib/interviews-logic";
import { useInterview, useRecording, useTranscript } from "@/lib/queries/interviews";
import { CAN, roleAllowed, useRole } from "@/lib/roles";

const TABS = ["transcript", "notes", "analysis"] as const;
type Tab = (typeof TABS)[number];

function DetailSkeleton() {
  return (
    <LoadingRegion label="Loading interview" className="space-y-4 p-4 medium:p-6">
      <Skeleton className="h-8 w-1/3 rounded-sm" />
      <Skeleton className="h-24 rounded-md" />
      <Skeleton className="h-96 rounded-md" />
    </LoadingRegion>
  );
}

function useHashSegment(): number | null {
  const [hash, setHash] = React.useState("");
  React.useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return parseSegmentTarget("", hash);
}

function InterviewDetailView({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const iv = useInterview(id);
  const role = useRole();
  const canEdit = roleAllowed(role, CAN.create);

  const hashSeg = useHashSegment();
  const focusId = parseSegmentTarget(params.toString()) ?? hashSeg;
  const requested = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? "") ? (requested as Tab) : "transcript";

  const data = iv.data;
  const processing = data?.status === "processing";
  const transcript = useTranscript(id, (!!data && data.segment_count > 0) || processing, processing);
  const recording = useRecording(id, !!data?.has_recording);
  const noRecording = recording.error instanceof ApiError && recording.error.code === "no_recording";

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transcript;
  React.useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const segments = React.useMemo(() => transcript.data?.pages.flatMap((p) => p.items) ?? [], [transcript.data]);

  // Keep a stable audio src; swap to the refreshed presigned URL and restore the position.
  const audio = React.useRef<AudioPlayerHandle>(null);
  const [currentMs, setCurrentMs] = React.useState(0);
  const lastMs = React.useRef(0);
  const url = recording.data?.url;
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!url) return;
    setSrc((prev) => {
      if (prev === url) return prev;
      const pos = lastMs.current;
      if (prev && pos > 0) setTimeout(() => audio.current?.seek(pos), 0);
      return url;
    });
  }, [url]);

  const setTab = (next: string) => {
    const sp = new URLSearchParams();
    sp.set("tab", next);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  if (iv.isLoading) return <DetailSkeleton />;
  if (iv.isError || !data) {
    return (
      <div className="p-6">
        <p role="alert" className="body-m text-error">
          {iv.error instanceof ApiError && iv.error.status === 404 ? "Interview not found." : `Error: ${(iv.error as Error | null)?.message ?? "could not load interview"}`}
        </p>
        <Link href="/interviews" className="mt-2 inline-block body-m text-primary hover:underline">
          ← Back to interviews
        </Link>
      </div>
    );
  }

  const botStatus = data.bot_session?.status ?? data.bot_status;
  const botActive = isBotActive(botStatus);
  const bot = data.bot_session;
  const failed = botStatus === "failed" && bot;

  return (
    <div className="space-y-5 p-4 medium:p-6">
      <div className="flex flex-wrap items-center gap-2 body-m text-on-surface-variant">
        <Link href="/interviews" className="focus-ring flex items-center gap-1 rounded-xs hover:text-on-surface">
          <Icon name="arrow_back" size={18} /> Interviews
        </Link>
      </div>

      <Card variant="filled" className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="headline-s">{data.title}</h1>
            <p className="body-m text-on-surface-variant">
              <Link href={`/candidate/${data.candidate_id}`} className="focus-ring rounded-xs text-primary hover:underline">
                {data.candidate_name}
              </Link>
              {data.role_name && (
                <>
                  {" · "}
                  {data.role_id ? (
                    <Link href={`/roles/${data.role_id}`} className="focus-ring rounded-xs text-primary hover:underline">
                      {data.role_name}
                    </Link>
                  ) : (
                    data.role_name
                  )}
                </>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-2 body-s text-on-surface-variant">
              <PlatformIcon platform={data.platform} />
              {platformLabel(data.platform)} · {formatWhen(data.scheduled_start)} ·{" "}
              <span className="capitalize">{data.status.replace(/_/g, " ")}</span>
              {data.meeting_url && (
                <a href={data.meeting_url} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-xs text-primary hover:underline">
                  Open meeting <Icon name="open_in_new" size={14} />
                </a>
              )}
            </p>
          </div>
          <InterviewStatusChip botStatus={botStatus} interviewStatus={data.status} />
        </div>

        {failed && (
          <div role="alert" className="flex items-start gap-3 rounded-md bg-error-container p-3 body-s text-on-error-container">
            <Icon name="error" size={20} filled />
            <p>{failureMessage(bot.failure_reason, bot.failure_detail)}</p>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-outline-variant pt-4">
          <BotControls
            interviewId={data.id}
            platform={data.platform}
            hasUrl={!!data.meeting_url}
            botActive={botActive}
            hasStart={!!data.scheduled_start}
            canEdit={canEdit && data.status !== "cancelled"}
          />
          <p className="flex max-w-md items-start gap-2 body-s text-on-surface-variant">
            <Icon name="info" size={18} />
            <span>
              When the notetaker joins, a recording notice is posted in the meeting chat.
              {bot?.consent_message_sent_at
                ? ` Notice sent ${new Date(bot.consent_message_sent_at).toLocaleString()}.`
                : " It has not been sent yet."}
            </span>
          </p>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="secondary">
          <TabsTrigger value="transcript">
            <Icon name="subject" size={18} /> Transcript
          </TabsTrigger>
          <TabsTrigger value="notes">
            <Icon name="notes" size={18} /> Notes
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <Icon name="psychology" size={18} /> Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="space-y-4 pt-4">
          {processing && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-md bg-ai-container p-3 body-s text-on-ai-container">
              <Icon name="sync" size={18} className="animate-m3-spin" /> Transcribing… the transcript appears here when it is ready.
            </div>
          )}
          {src && !noRecording && (
            <AudioPlayer
              ref={audio}
              src={src}
              onTimeUpdate={(ms) => {
                lastMs.current = ms;
                setCurrentMs(ms);
              }}
            />
          )}
          {transcript.isLoading ? (
            <Skeleton className="h-64 rounded-md" />
          ) : segments.length > 0 ? (
            <TranscriptPane
              segments={segments}
              currentMs={src ? currentMs : undefined}
              focusId={focusId}
              loadingMore={isFetchingNextPage}
              onSeek={(ms) => audio.current?.seek(ms, true)}
            />
          ) : (
            !processing && (
              <Card variant="outlined" className="border-dashed p-8 text-center body-m text-on-surface-variant">
                No transcript yet. Send the notetaker to the call or upload a transcript or recording below.
              </Card>
            )
          )}
          <SpeakerMapping interview={data} canEdit={canEdit} hasAudioOnly={data.has_recording && data.platform === "upload"} />
          {canEdit && <UploadPanel interviewId={data.id} processing={processing} />}
        </TabsContent>

        <TabsContent value="notes" className="pt-4">
          <NotesPanel notes={data.notes} />
        </TabsContent>

        <TabsContent value="analysis" className="pt-4">
          <AnalysisPanel interviewId={data.id} analysisId={data.analysis_id} canEdit={canEdit} hasTranscript={data.segment_count > 0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function InterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <React.Suspense fallback={<DetailSkeleton />}>
      <InterviewDetailView id={id} />
    </React.Suspense>
  );
}
