"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Icon, LinearProgress, useSnackbar } from "@/components/m3";
import { ApiError } from "@/lib/api";
import { interviewsApi, uploadRecording } from "@/lib/api-interviews";
import { isTranscriptFile, uploadErrorMessage } from "@/lib/interviews-logic";
import { ivKeys, useOrgId } from "@/lib/queries/interviews";

function msg(e: unknown): string {
  if (e instanceof ApiError) return uploadErrorMessage(e.code, e.detail);
  return e instanceof Error ? e.message : "Upload failed";
}

/** Transcript file + audio/video upload (presigned PUT with progress). */
export function UploadPanel({ interviewId, processing }: { interviewId: number; processing: boolean }) {
  const qc = useQueryClient();
  const org = useOrgId();
  const snack = useSnackbar();
  const [busy, setBusy] = React.useState<"transcript" | "recording" | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ivKeys.detail(org, interviewId) });
    void qc.invalidateQueries({ queryKey: ivKeys.transcript(org, interviewId) });
    void qc.invalidateQueries({ queryKey: ivKeys.recording(org, interviewId) });
  };

  const onTranscript = async (file: File) => {
    setError(null);
    if (!isTranscriptFile(file.name)) return setError(uploadErrorMessage("unsupported_file", ""));
    setBusy("transcript");
    try {
      await interviewsApi.uploadTranscript(interviewId, file);
      snack.show("Transcript uploaded");
      refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const onRecording = async (file: File) => {
    setError(null);
    setBusy("recording");
    setProgress(0);
    try {
      await uploadRecording(interviewId, file, { onProgress: setProgress });
      snack.show("Recording uploaded. Transcribing…");
      refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = (kind: "transcript" | "recording", accept: string, label: string, hint: string, icon: "description" | "mic") => (
    <label className="state-layer relative flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-outline-variant p-4 focus-within:outline-3 focus-within:outline-secondary">
      <Icon name={icon} className="text-on-surface-variant" />
      <div className="min-w-0 flex-1">
        <p className="label-l">{label}</p>
        <p className="label-s text-on-surface-variant">{hint}</p>
      </div>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy != null || processing}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void (kind === "transcript" ? onTranscript(f) : onRecording(f));
        }}
      />
    </label>
  );

  return (
    <Card variant="outlined" className="space-y-3 p-5">
      <h3 className="title-m">Upload</h3>
      <div className="grid gap-3 medium:grid-cols-2">
        {pick("transcript", ".txt,.vtt,.srt,.docx", "Upload transcript", ".txt, .vtt, .srt or .docx", "description")}
        {pick("recording", "audio/*,video/*", "Upload audio or video", "Transcribed automatically", "mic")}
      </div>
      <p className="body-s text-on-surface-variant">
        Audio and video uploads have no speaker labels, so map each speaker to the candidate or interviewer manually after transcription.
      </p>
      {busy === "recording" && (
        <div role="status" className="space-y-1">
          <LinearProgress value={Math.round(progress * 100)} aria-label="Upload progress" />
          <p className="label-s text-on-surface-variant">Uploading… {Math.round(progress * 100)}%</p>
        </div>
      )}
      {busy === "transcript" && (
        <p role="status" className="label-s text-on-surface-variant">
          Uploading transcript…
        </p>
      )}
      {processing && busy == null && (
        <div role="status" aria-live="polite" className="space-y-1">
          <LinearProgress aria-label="Transcribing" />
          <p className="label-s text-on-surface-variant">Transcribing… this can take a few minutes.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="body-s text-error">
          {error}
        </p>
      )}
    </Card>
  );
}
