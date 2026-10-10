/**
 * Maps domain values to design-token class names. Class strings are written out
 * in full so Tailwind can see them statically.
 */

export type MatchTone = "strong" | "medium" | "weak" | "none";

export function scoreTone(score: number | null | undefined): MatchTone {
  if (score == null || score <= 0) return "none";
  if (score >= 80) return "strong";
  if (score >= 60) return "medium";
  return "weak";
}

export const toneText: Record<MatchTone, string> = {
  strong: "text-match-strong",
  medium: "text-match-medium",
  weak: "text-match-weak",
  none: "text-on-surface-variant",
};

export const toneBar: Record<MatchTone, string> = {
  strong: "bg-match-strong",
  medium: "bg-match-medium",
  weak: "bg-match-weak",
  none: "bg-outline",
};

export const toneStroke: Record<MatchTone, string> = {
  strong: "stroke-match-strong",
  medium: "stroke-match-medium",
  weak: "stroke-match-weak",
  none: "stroke-outline",
};

export const toneContainer: Record<MatchTone, string> = {
  strong: "bg-match-strong-container text-on-match-strong-container",
  medium: "bg-match-medium-container text-on-match-medium-container",
  weak: "bg-match-weak-container text-on-match-weak-container",
  none: "bg-surface-container-highest text-on-surface-variant",
};

/** Pipeline stage → token classes (replaces the hex colour the backend sends). */
export type StageTone = {
  dot: string;
  chip: string;
  text: string;
  ring: string;
};

export const STAGE_TONES: Record<string, StageTone> = {
  applied: {
    dot: "bg-outline",
    chip: "bg-surface-container-highest text-on-surface-variant",
    text: "text-on-surface-variant",
    ring: "border-outline",
  },
  screening: {
    dot: "bg-match-medium",
    chip: "bg-match-medium-container text-on-match-medium-container",
    text: "text-match-medium",
    ring: "border-match-medium",
  },
  interview: {
    dot: "bg-primary",
    chip: "bg-primary-container text-on-primary-container",
    text: "text-primary",
    ring: "border-primary",
  },
  offer: {
    dot: "bg-match-strong",
    chip: "bg-match-strong-container text-on-match-strong-container",
    text: "text-match-strong",
    ring: "border-match-strong",
  },
  hired: {
    dot: "bg-ai",
    chip: "bg-ai-container text-on-ai-container",
    text: "text-ai",
    ring: "border-ai",
  },
};

export function stageTone(stage: string): StageTone {
  return STAGE_TONES[stage] ?? STAGE_TONES.applied;
}
