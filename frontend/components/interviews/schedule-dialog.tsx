"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, DateTimePicker, Dialog, DialogContent, Icon, IconButton, Select, TextField, useSnackbar } from "@/components/m3";
import { ApiError } from "@/lib/api";
import type { ParticipantIn } from "@/lib/api-interviews";
import { botSupported, detectPlatform, platformHint } from "@/lib/interviews-logic";
import { useCandidateOptions, useCreateInterview } from "@/lib/queries/interviews";
import { cn } from "@/lib/utils";

interface Extra {
  name: string;
  email: string;
}

/** Schedule an interview / paste a meeting link. */
export function ScheduleDialog({
  open,
  onOpenChange,
  candidateId,
  navigateOnCreate = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects (and locks) the candidate. */
  candidateId?: number;
  navigateOnCreate?: boolean;
}) {
  const candidates = useCandidateOptions();
  const create = useCreateInterview();
  const router = useRouter();
  const snack = useSnackbar();

  const [candState, setCand] = React.useState<string>("");
  const cand = candidateId ? String(candidateId) : candState;
  const [title, setTitle] = React.useState("");
  const [start, setStart] = React.useState<Date | null>(null);
  const [url, setUrl] = React.useState("");
  const [extras, setExtras] = React.useState<Extra[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const options = (candidates.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.role}` }));
  const selected = (candidates.data ?? []).find((c) => c.id === cand);
  const hint = platformHint(url);
  const platform = detectPlatform(url);
  const urlInvalid = url.trim() !== "" && platform == null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selected) return setError("Choose a candidate.");
    if (!title.trim()) return setError("Add a title.");
    if (urlInvalid) return setError("That meeting link isn't a supported platform.");
    const participants: ParticipantIn[] = extras
      .filter((x) => x.name.trim())
      .map((x) => ({ display_name: x.name.trim(), email: x.email.trim() || null, kind: "interviewer" as const }));
    const trimmed = url.trim();
    create.mutate(
      {
        candidate_id: Number(selected.id),
        role_id: selected.role_id,
        title: title.trim(),
        scheduled_start: start ? start.toISOString() : null,
        scheduled_end: start ? new Date(start.getTime() + 60 * 60 * 1000).toISOString() : null,
        meeting_url: trimmed ? (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) : null,
        participants,
      },
      {
        onSuccess: (iv) => {
          snack.show("Interview scheduled");
          onOpenChange(false);
          setTitle("");
          setUrl("");
          setStart(null);
          setExtras([]);
          if (navigateOnCreate) router.push(`/interviews/${iv.id}`);
        },
        onError: (err) => setError(err instanceof ApiError ? err.detail : "Could not schedule the interview."),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent icon="event" title="Schedule an interview" description="Paste a meeting link so the notetaker can join, or schedule now and upload a transcript later." fullScreenOnMobile>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Select
            label="Candidate"
            options={options}
            value={cand}
            onValueChange={setCand}
            disabled={!!candidateId}
            supportingText={candidates.isLoading ? "Loading candidates…" : undefined}
          />
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Technical round 1" maxLength={200} />
          <DateTimePicker label="Start time" value={start} onChange={setStart} />
          <div>
            <TextField
              label="Meeting link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              leadingIcon="link"
              error={urlInvalid ? hint?.text : undefined}
              supportingText={!urlInvalid ? hint?.text : undefined}
              inputMode="url"
            />
            {platform && !botSupported(platform) && (
              <p className={cn("mt-2 flex items-start gap-2 rounded-md bg-match-medium-container p-3 body-s text-on-match-medium-container")}>
                <Icon name="info" size={18} />
                Teams and Zoom aren&apos;t supported by the notetaker yet. You can still schedule the interview and upload a transcript or recording afterwards.
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="label-l text-on-surface-variant">Other interviewers (optional)</legend>
            {extras.map((x, i) => (
              <div key={i} className="flex items-start gap-2">
                <TextField
                  label="Name"
                  containerClassName="flex-1"
                  value={x.name}
                  onChange={(e) => setExtras((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                />
                <TextField
                  label="Email"
                  type="email"
                  containerClassName="flex-1"
                  value={x.email}
                  onChange={(e) => setExtras((p) => p.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))}
                />
                <IconButton icon="close" label="Remove interviewer" onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button type="button" variant="text" size="sm" icon="person_add" onClick={() => setExtras((p) => [...p, { name: "", email: "" }])}>
              Add interviewer
            </Button>
          </fieldset>

          {error && (
            <p role="alert" className="body-s text-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="text" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
