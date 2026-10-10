"use client";

import * as React from "react";
import { Button, Checkbox, Dialog, DialogContent, Icon, SummaryCard } from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { useSnackbar } from "@/components/m3/snackbar";
import { apiMessage, type SummaryCardData } from "@/lib/api-ranking";
import { useReveal } from "@/lib/queries/ranking";
import { cn } from "@/lib/utils";
import { toSummaryProps } from "./card-adapter";

export function IdentityHiddenChip() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-tertiary-container px-2 label-m text-on-tertiary-container">
      <Icon name="visibility_off" size={16} />
      Identity hidden
    </span>
  );
}

export function RevealButton({ candidateId, name }: { candidateId: number; name: string }) {
  const [open, setOpen] = React.useState(false);
  const reveal = useReveal();
  const snackbar = useSnackbar();
  return (
    <RequireRole roles={["admin", "recruiter", "hiring_manager"]}>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button variant="outlined" size="sm" icon="visibility" onClick={() => setOpen(true)} aria-label={`Reveal identity of ${name}`}>
          Reveal
        </Button>
        <DialogContent
          icon="visibility"
          title="Reveal candidate identity?"
          description="Blind review is on for your organisation. Revealing shows this candidate's name, photo and email. The reveal is recorded in the audit log with your name."
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={reveal.isPending}
                onClick={() =>
                  reveal.mutate(candidateId, {
                    onSuccess: () => {
                      setOpen(false);
                      snackbar.show("Identity revealed (logged)");
                    },
                    onError: (e) => snackbar.show(apiMessage(e)),
                  })
                }
              >
                Reveal and log
              </Button>
            </>
          }
        />
      </Dialog>
    </RequireRole>
  );
}

function EvidenceList({ card }: { card: SummaryCardData }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const criteria = card.resume_fit?.criteria ?? [];
  if (criteria.length === 0) return null;
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex h-8 items-center gap-1 rounded-sm px-2 label-l text-primary hover:bg-primary/8"
      >
        <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={18} />
        {open ? "Hide evidence" : "Show evidence"}
      </button>
      {open && (
        <ul id={id} className="mt-2 flex flex-col gap-3">
          {criteria.map((c) => (
            <li key={c.criterion_id} className="rounded-sm bg-surface-container px-3 py-2">
              <p className="flex items-center gap-2 label-l text-on-surface">
                {c.name}
                {c.must_have && (
                  <span className="rounded-xs bg-secondary-container px-1.5 label-s text-on-secondary-container">Must-have</span>
                )}
                <span className="ms-auto tabular-nums text-on-surface-variant">{c.score}/5</span>
              </p>
              {c.evidence.length === 0 ? (
                <p className="mt-1 body-s italic text-on-surface-variant">No supporting quote found in the resume.</p>
              ) : (
                c.evidence.map((q, i) => (
                  <blockquote key={i} className="mt-1 border-s-2 border-outline ps-2 body-s text-on-surface-variant">
                    “{q}”
                  </blockquote>
                ))
              )}
              {c.reasoning && <p className="mt-1 body-s text-on-surface">{c.reasoning}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CandidateSummaryCardProps {
  card: SummaryCardData;
  selected?: boolean;
  /** Show a "compare" checkbox. */
  onSelectedChange?: (selected: boolean) => void;
  selectDisabled?: boolean;
  className?: string;
}

/** Ranked-list card: the M3 `SummaryCard` plus evidence, must-have warning, blind-review and selection controls. */
export function CandidateSummaryCard({ card, selected, onSelectedChange, selectDisabled, className }: CandidateSummaryCardProps) {
  const p = toSummaryProps(card);
  const fit = card.resume_fit;
  const blind = card.candidate.blind;
  const subtitle = blind ? undefined : (p.subtitle ?? undefined);
  return (
    <div className={cn("relative", selected && "rounded-md outline-2 outline-primary", className)} data-blind={blind || undefined}>
      <SummaryCard
        name={p.name}
        subtitle={subtitle}
        avatarSrc={p.avatarSrc}
        fitScore={p.fitScore}
        criteria={p.criteria}
        interviewScores={p.interviewScores}
        claimFlags={p.claimFlags}
        notesExcerpt={p.notesExcerpt}
        aiSuggestion={p.aiSuggestion}
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {blind && <IdentityHiddenChip />}
          {!p.scored && (
            <span className="inline-flex h-6 items-center rounded-sm bg-surface-container-highest px-2 label-m text-on-surface-variant">
              {fit?.status === "failed" ? "Scoring failed" : fit?.status === "shortlisted" ? "Shortlisted, scoring…" : "Not scored yet"}
            </span>
          )}
          {fit?.stale && (
            <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-match-medium-container px-2 label-m text-on-match-medium-container">
              <Icon name="update" size={16} />
              Rubric changed, re-rank pending
            </span>
          )}
          {fit?.must_have_failed && (
            <span
              role="note"
              className="inline-flex h-6 items-center gap-1 rounded-sm bg-match-weak-container px-2 label-m text-on-match-weak-container"
            >
              <Icon name="warning" size={16} filled />
              Missing a must-have
            </span>
          )}
          {blind && <RevealButton candidateId={card.candidate.id} name={card.candidate.name} />}
        </div>
        <EvidenceList card={card} />
        {onSelectedChange && (
          <div className="mt-2">
            <Checkbox
              label="Select to compare"
              checked={!!selected}
              disabled={selectDisabled && !selected}
              onCheckedChange={(v) => onSelectedChange(v === true)}
              aria-label={`Select ${card.candidate.name} to compare`}
            />
          </div>
        )}
      </SummaryCard>
    </div>
  );
}
