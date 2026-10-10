"use client";

import Link from "next/link";
import { Card, Icon, Skeleton, scoreTone, toneContainer } from "@/components/m3";
import { cn } from "@/lib/utils";
import { useMatches } from "@/lib/queries/ranking";

/** "Also a strong fit for…": other open roles this candidate matches (`GET /candidates/{id}/matches`). */
export function CandidateMatchesCard({ candidateId, className }: { candidateId: string | number; className?: string }) {
  const { data, isLoading, isError } = useMatches(candidateId);
  const others = (data ?? []).filter((m) => !m.is_primary);

  if (isError) return null;
  return (
    <Card variant="outlined" className={cn("p-4", className)} aria-label="Also a strong fit for">
      <h3 className="mb-3 flex items-center gap-2 title-s text-on-surface">
        <Icon name="work" size={18} className="text-primary" />
        Also a strong fit for…
      </h3>
      {isLoading ? (
        <div className="flex gap-2" aria-hidden>
          <Skeleton className="h-8 w-32 rounded-sm" />
          <Skeleton className="h-8 w-24 rounded-sm" />
        </div>
      ) : others.length === 0 ? (
        <p className="body-s text-on-surface-variant">No other open roles match this candidate yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {others.map((m) => {
            const tone = m.strong ? "strong" : scoreTone(m.overall_score);
            return (
              <li key={m.role_id}>
                <Link
                  href={`/roles/${m.role_id}?tab=ranking`}
                  className={cn(
                    "focus-ring inline-flex h-8 items-center gap-2 rounded-sm border px-3 label-l transition-colors",
                    m.strong
                      ? cn("border-transparent", toneContainer.strong)
                      : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
                  )}
                  data-strong={m.strong || undefined}
                >
                  {m.strong && <Icon name="star" size={16} filled />}
                  {m.role_name}
                  {m.overall_score != null && (
                    <span className={cn("tabular-nums", !m.strong && tone !== "none" && "font-medium")}>
                      {Math.round(m.overall_score)}%
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
