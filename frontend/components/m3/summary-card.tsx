"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { ScoreRing } from "./score-ring";
import { CriterionBar } from "./criterion-bar";
import { ClaimCheckBadge, type ClaimStatus } from "./claim-check-badge";
import { CandidateAvatar } from "./candidate-avatar";
import { Icon } from "./icon";

export type AiSuggestion = "strong_yes" | "yes" | "lean_no" | "no";

const SUGGESTION: Record<AiSuggestion, { label: string; className: string }> = {
  strong_yes: { label: "Strong yes", className: "bg-match-strong-container text-on-match-strong-container" },
  yes: { label: "Yes", className: "bg-match-strong-container text-on-match-strong-container" },
  lean_no: { label: "Lean no", className: "bg-match-medium-container text-on-match-medium-container" },
  no: { label: "No", className: "bg-match-weak-container text-on-match-weak-container" },
};

export interface SummaryCardProps {
  name: string;
  subtitle?: string;
  avatarSrc?: string | null;
  /** Resume fit score 0-100. */
  fitScore: number;
  criteria?: { label: string; score: number }[];
  interviewScores?: { label: string; score: number }[];
  claimFlags?: { status: ClaimStatus; text: string }[];
  /** Short excerpt of interviewer notes. */
  notesExcerpt?: string;
  aiSuggestion?: AiSuggestion;
  onPress?: () => void;
  className?: string;
  /** Optional shared-element id for container-transform to the detail view. */
  children?: React.ReactNode;
}

/** Props-driven candidate summary: fit score, criteria, interview scores, claim flags, notes, AI suggestion. */
export function SummaryCard({
  name,
  subtitle,
  avatarSrc,
  fitScore,
  criteria = [],
  interviewScores = [],
  claimFlags = [],
  notesExcerpt,
  aiSuggestion,
  onPress,
  className,
  children,
}: SummaryCardProps) {
  return (
    <Card variant="elevated" onPress={onPress} className={cn("p-4", className)} aria-label={onPress ? `Open ${name}` : undefined}>
      <div className="flex items-start gap-4">
        <CandidateAvatar name={name} src={avatarSrc} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate title-m text-on-surface">{name}</h3>
          {subtitle && <p className="truncate body-m text-on-surface-variant">{subtitle}</p>}
          <p className="mt-1 label-s text-on-surface-variant">Resume fit</p>
        </div>
        <ScoreRing value={fitScore} size={64} label={`Resume fit score ${Math.round(fitScore)}`} />
      </div>

      {criteria.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {criteria.map((c) => (
            <CriterionBar key={c.label} label={c.label} value={c.score} />
          ))}
        </div>
      )}

      {interviewScores.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 label-m text-on-surface-variant">Interview</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {interviewScores.map((c) => (
              <CriterionBar key={c.label} label={c.label} value={c.score} />
            ))}
          </div>
        </div>
      )}

      {claimFlags.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {claimFlags.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <ClaimCheckBadge status={f.status} />
              <span className="line-clamp-2 min-w-0 flex-1 body-s text-on-surface-variant">{f.text}</span>
            </li>
          ))}
        </ul>
      )}

      {notesExcerpt && (
        <p className="mt-4 line-clamp-3 rounded-sm bg-surface-container px-3 py-2 body-s text-on-surface-variant">{notesExcerpt}</p>
      )}

      {children}

      {aiSuggestion && (
        <div className="mt-4 flex flex-col gap-1 border-t border-outline-variant pt-3">
          <span className="flex items-center gap-2">
            <Icon name="psychology" size={18} className="text-ai" filled />
            <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", SUGGESTION[aiSuggestion].className)}>
              {SUGGESTION[aiSuggestion].label}
            </span>
          </span>
          <span className="label-s text-on-surface-variant">AI suggestion — final decision by your team</span>
        </div>
      )}
    </Card>
  );
}
