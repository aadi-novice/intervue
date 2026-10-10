"use client";

import * as React from "react";
import { Button, Card, Icon, Select, useSnackbar } from "@/components/m3";
import { ApiError } from "@/lib/api";
import type { InterviewDetail } from "@/lib/api-interviews";
import {
  buildSpeakerPayload,
  draftsFromSpeakers,
  hasCandidateSpeaker,
  type SpeakerDraft,
  type SpeakerKind,
} from "@/lib/interviews-logic";
import { useMapSpeakers } from "@/lib/queries/interviews";

const NONE = "none";

export function SpeakerMapping({
  interview,
  canEdit,
  hasAudioOnly = false,
}: {
  interview: InterviewDetail;
  canEdit: boolean;
  hasAudioOnly?: boolean;
}) {
  const original = React.useMemo(() => draftsFromSpeakers(interview.speakers), [interview.speakers]);
  const [edited, setEdited] = React.useState<SpeakerDraft[]>(original);
  const [error, setError] = React.useState<string | null>(null);
  const map = useMapSpeakers(interview.id);
  const snack = useSnackbar();

  // Re-sync when the server data changes (e.g. after save or a transcript upload).
  const sig = JSON.stringify(original);
  const [syncedSig, setSyncedSig] = React.useState(sig);
  if (syncedSig !== sig) {
    setSyncedSig(sig);
    setEdited(original);
  }

  if (interview.speakers.length === 0) return null;

  const unmapped = !hasCandidateSpeaker(interview.speakers);
  const payload = buildSpeakerPayload(original, edited);
  const dirty = payload.mappings.length > 0;
  const participantOptions = [
    { value: NONE, label: "Not assigned" },
    ...interview.participants.map((p) => ({ value: String(p.id), label: `${p.display_name} (${p.kind})` })),
  ];

  const update = (label: string, patch: Partial<SpeakerDraft>) =>
    setEdited((rows) => rows.map((r) => (r.speaker_label === label ? { ...r, ...patch } : r)));

  const pickParticipant = (label: string, value: string) => {
    if (value === NONE) return update(label, { participant_id: null });
    const p = interview.participants.find((x) => String(x.id) === value);
    const kind: SpeakerKind | undefined = p?.kind === "candidate" ? "candidate" : p?.kind === "interviewer" ? "interviewer" : undefined;
    update(label, { participant_id: Number(value), ...(kind ? { kind } : {}) });
  };

  const save = () => {
    setError(null);
    map.mutate(payload, {
      onSuccess: () => snack.show("Speakers updated"),
      onError: (e) => setError(e instanceof ApiError ? e.detail : "Could not save speakers"),
    });
  };

  return (
    <Card variant="outlined" className="space-y-4 p-5">
      <div>
        <h3 className="title-m">Speakers</h3>
        <p className="body-s text-on-surface-variant">Tell us who is who. Analysis only cites lines spoken by the speaker mapped to the candidate.</p>
      </div>
      {unmapped && (
        <div role="alert" className="flex items-start gap-3 rounded-md bg-match-medium-container p-3 body-s text-on-match-medium-container">
          <Icon name="warning" size={20} filled />
          <p>
            No speaker is mapped to the candidate yet. Analysis needs at least one speaker marked as the candidate (<code>speakers_unmapped</code>).
            {hasAudioOnly && " Audio uploads have no speaker labels, so speakers must be mapped manually."}
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {edited.map((s) => {
          const count = interview.speakers.find((x) => x.speaker_label === s.speaker_label)?.segment_count ?? 0;
          return (
            <li key={s.speaker_label} className="grid items-start gap-3 rounded-md bg-surface-container p-3 medium:grid-cols-[1fr_1fr_10rem]">
              <div className="min-w-0">
                <p className="truncate label-l">{s.speaker_label}</p>
                <p className="label-s text-on-surface-variant">
                  {count} segment{count === 1 ? "" : "s"}
                </p>
              </div>
              <Select
                label="Participant"
                value={s.participant_id == null ? NONE : String(s.participant_id)}
                onValueChange={(v) => pickParticipant(s.speaker_label, v)}
                options={participantOptions}
                disabled={!canEdit}
              />
              <Select
                label="Role in call"
                value={s.kind}
                onValueChange={(v) => update(s.speaker_label, { kind: v as SpeakerKind })}
                options={[
                  { value: "interviewer", label: "Interviewer" },
                  { value: "candidate", label: "Candidate" },
                  { value: "unknown", label: "Unknown" },
                ]}
                disabled={!canEdit}
              />
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="body-s text-error">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button disabled={!dirty} loading={map.isPending} onClick={save}>
            Save speakers
          </Button>
        </div>
      )}
    </Card>
  );
}
