"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, Select } from "@/components/m3";
import type { CalendarEvent } from "@/lib/api-calendar";

export interface CandidateOption {
  id: number;
  name: string;
}

/** Pick which candidate an unmatched meeting is with, then tag it for the notetaker. */
export function TagDialog({
  event,
  candidates,
  loading,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  event: CalendarEvent | null;
  candidates: CandidateOption[];
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onConfirm: (candidateId: number) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={event != null} onOpenChange={(o) => !o && onClose()}>
      {event && (
        <TagDialogBody
          key={event.id}
          event={event}
          candidates={candidates}
          loading={loading}
          submitting={submitting}
          error={error}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function TagDialogBody({
  event,
  candidates,
  loading,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  event: CalendarEvent;
  candidates: CandidateOption[];
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onConfirm: (candidateId: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const missing = touched && !value ? "Choose which candidate this meeting is with." : undefined;
  return (
    <DialogContent
      icon="sell"
      title="Tag for notetaker"
      description={`No known candidate was found among the attendees of "${event.title}". Choose who this meeting is with so an interview can be created.`}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            onClick={() => {
              setTouched(true);
              if (value) onConfirm(Number(value));
            }}
          >
            Tag meeting
          </Button>
        </>
      }
    >
      <Select
        label="Candidate"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          setTouched(true);
        }}
        options={candidates.map((c) => ({ value: String(c.id), label: c.name }))}
        disabled={loading}
        error={missing}
        supportingText={loading ? "Loading candidates" : candidates.length === 0 ? "No candidates yet. Add one first." : undefined}
      />
      {error && (
        <p role="alert" className="mt-3 body-m text-error">
          {error}
        </p>
      )}
    </DialogContent>
  );
}
