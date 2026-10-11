"use client";

import * as React from "react";
import { BotStatusChip, Button, Dialog, DialogContent, Icon, useSnackbar, type BotStatus, type IconName } from "@/components/m3";
import { ApiError } from "@/lib/api";
import { BOT_STATUS_META } from "@/components/m3/bot-status-chip";
import { botErrorMessage, botSupported, PLATFORM_LABEL, TEAMS_GUEST_HINT, type Platform } from "@/lib/interviews-logic";
import { useSendBot, useSendBotFor, useStopBot } from "@/lib/queries/interviews";
import { cn } from "@/lib/utils";

const PLATFORM_ICON: Record<string, IconName> = {
  google_meet: "videocam",
  teams: "groups",
  zoom: "video_call",
  jitsi: "videocam",
  upload: "upload_file",
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const label = PLATFORM_LABEL[platform as Platform] ?? platform;
  return <Icon name={PLATFORM_ICON[platform] ?? "videocam"} size={20} label={label} className={cn("text-on-surface-variant", className)} />;
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform as Platform] ?? platform;
}

const KNOWN = Object.keys(BOT_STATUS_META);

/** Live bot status; falls back to a neutral processing chip while the post-call pipeline runs. */
export function InterviewStatusChip({
  botStatus,
  interviewStatus,
  className,
}: {
  botStatus: string | null | undefined;
  interviewStatus?: string;
  className?: string;
}) {
  if (botStatus && KNOWN.includes(botStatus)) {
    // A finished call that is still being transcribed reads as Processing.
    const s = botStatus === "completed" && interviewStatus === "processing" ? "processing" : botStatus;
    return <BotStatusChip status={s as BotStatus} className={className} />;
  }
  if (interviewStatus === "processing") return <BotStatusChip status="processing" className={className} />;
  if (interviewStatus === "cancelled") {
    return (
      <span className={cn("inline-flex h-8 items-center rounded-sm bg-surface-container-highest px-3 label-l text-on-surface-variant", className)}>
        Cancelled
      </span>
    );
  }
  return null;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return botErrorMessage(e.code, e.detail);
  return e instanceof Error ? e.message : "Something went wrong";
}

/** "Send notetaker" (now / at start) and "Stop notetaker" with a confirm dialog. */
export function BotControls({
  interviewId,
  platform,
  hasUrl,
  botActive,
  hasStart,
  canEdit,
}: {
  interviewId: number;
  platform: string;
  hasUrl: boolean;
  botActive: boolean;
  hasStart: boolean;
  canEdit: boolean;
}) {
  const send = useSendBot(interviewId);
  const stop = useStopBot(interviewId);
  const snack = useSnackbar();
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!canEdit) return null;

  if (!hasUrl || !botSupported(platform)) {
    return (
      <p className="body-s text-on-surface-variant">
        {hasUrl
          ? `The notetaker can't join ${platformLabel(platform)} yet. Upload a transcript or recording instead.`
          : "Add a meeting link to use the notetaker, or upload a transcript or recording."}
      </p>
    );
  }

  const run = (mode: "now" | "scheduled") => {
    setError(null);
    send.mutate(mode, {
      onSuccess: () => snack.show(mode === "now" ? "Notetaker is on its way" : "Notetaker scheduled for the start time"),
      onError: (e) => setError(errMsg(e)),
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {botActive ? (
          <Button variant="outlined" icon="stop_circle" loading={stop.isPending} onClick={() => setConfirm(true)}>
            Stop notetaker
          </Button>
        ) : (
          <>
            <Button variant="tonal" icon="smart_toy" loading={send.isPending} onClick={() => run("now")}>
              Send notetaker now
            </Button>
            {hasStart && (
              <Button variant="text" icon="schedule" disabled={send.isPending} onClick={() => run("scheduled")}>
                Send at start time
              </Button>
            )}
          </>
        )}
      </div>
      {platform === "teams" && !botActive && <p className="body-s text-on-surface-variant">{TEAMS_GUEST_HINT}</p>}
      {error && (
        <p role="alert" className="body-s text-error">
          {error}
        </p>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          icon="stop_circle"
          title="Stop the notetaker?"
          description="The notetaker will leave the meeting. Anything captured so far is kept and processed."
          actions={
            <>
              <Button variant="text" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                loading={stop.isPending}
                onClick={() =>
                  stop.mutate(undefined, {
                    onSuccess: () => {
                      setConfirm(false);
                      snack.show("Notetaker stopped");
                    },
                    onError: (e) => {
                      setConfirm(false);
                      setError(errMsg(e));
                    },
                  })
                }
              >
                Stop notetaker
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}

/** Compact bot toggle for list rows (dashboard). */
export function BotToggleButton({
  interviewId,
  platform,
  hasUrl,
  botStatus,
  canEdit,
}: {
  interviewId: number;
  platform: string;
  hasUrl: boolean;
  botStatus: string | null;
  canEdit: boolean;
}) {
  const send = useSendBotFor();
  const snack = useSnackbar();
  if (botStatus && ["scheduled", "launching", "joining", "waiting_admission", "in_call", "leaving", "processing", "completed", "failed"].includes(botStatus)) {
    return <InterviewStatusChip botStatus={botStatus} />;
  }
  if (!canEdit || !hasUrl || !botSupported(platform)) return null;
  return (
    <Button
      variant="tonal"
      size="sm"
      icon="smart_toy"
      loading={send.isPending}
      onClick={() =>
        send.mutate(
          { id: interviewId, mode: "now" },
          {
            onSuccess: () => snack.show("Notetaker is on its way"),
            onError: (e) => snack.show(errMsg(e)),
          },
        )
      }
    >
      Send notetaker
    </Button>
  );
}
