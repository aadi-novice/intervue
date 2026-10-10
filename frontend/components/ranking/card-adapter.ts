import type { AiSuggestion, ClaimStatus } from "@/components/m3";
import type { SuggestionLabel, SummaryCardData } from "@/lib/api-ranking";

const SUGGESTION_KEY: Record<SuggestionLabel, AiSuggestion> = {
  "Strong yes": "strong_yes",
  Yes: "yes",
  "Lean no": "lean_no",
  No: "no",
};

export function suggestionKey(label: SuggestionLabel | null | undefined): AiSuggestion | undefined {
  return label ? SUGGESTION_KEY[label] : undefined;
}

/** Rubric scores are 0-5; the M3 bars are 0-100. */
export const criterionPercent = (score: number) => Math.max(0, Math.min(100, (score / 5) * 100));

/** What may be displayed for a candidate. Blind candidates never expose email/avatar. */
export function displayIdentity(c: SummaryCardData["candidate"]) {
  return {
    name: c.name,
    email: c.blind ? null : c.email,
    avatarSrc: c.blind ? null : c.avatar_url,
    blind: c.blind,
  };
}

const VERDICT_RANK: Record<ClaimStatus, number> = { contradicted: 0, unclear: 1, verified: 2 };

/** Props for the M3 `SummaryCard` from API data. Contradicted claims first. */
export function toSummaryProps(card: SummaryCardData) {
  const id = displayIdentity(card.candidate);
  const fit = card.resume_fit;
  const scored = fit?.status === "scored" && fit.overall_score != null;
  return {
    name: id.name,
    subtitle: id.email ?? undefined,
    avatarSrc: id.avatarSrc,
    fitScore: scored ? (fit?.overall_score as number) : 0,
    scored,
    criteria: (fit?.criteria ?? []).map((c) => ({ label: c.name, score: criterionPercent(c.score) })),
    interviewScores: card.interview
      ? [
          { label: "Technical", score: card.interview.technical_score },
          { label: "Communication", score: card.interview.communication_score },
          { label: "Confidence", score: card.interview.confidence_score },
        ]
      : [],
    claimFlags: [...card.claim_checks.flags]
      .filter((f) => f.verdict !== "verified")
      .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
      .map((f) => ({ status: f.verdict as ClaimStatus, text: f.claim })),
    notesExcerpt: card.notes_excerpt ?? undefined,
    aiSuggestion: suggestionKey(card.suggestion.label),
  };
}
