"use client";

import { EmptyState, Skeleton } from "@/components/m3";
import { useSummaryCardData } from "@/lib/queries/ranking";
import { CandidateSummaryCard } from "./candidate-summary-card";

/** Per-candidate summary card (`GET /candidates/{id}/summary-card`), optionally for a specific role. */
export function SummaryCardPanel({ candidateId, roleId }: { candidateId: string | number; roleId?: number }) {
  const { data, isLoading, isError } = useSummaryCardData(candidateId, roleId);
  if (isLoading) return <Skeleton className="h-56 rounded-md" />;
  if (isError || !data) {
    return <EmptyState icon="summarize" title="No summary yet">Upload a resume and rank the role to see the summary card.</EmptyState>;
  }
  return <CandidateSummaryCard card={data} />;
}
