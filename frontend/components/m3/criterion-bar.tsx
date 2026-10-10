"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { duration, easing } from "@/app/theme/motion";
import { scoreTone, toneBar, toneText, type MatchTone } from "./tones";

export interface CriterionBarProps {
  label: string;
  /** 0-100. A value of 0 renders an empty bar with an em dash. */
  value: number;
  tone?: MatchTone;
  /** Emphasise (e.g. best in a comparison row). */
  highlight?: boolean;
  className?: string;
}

/** Labelled score bar for a single rubric criterion. */
export function CriterionBar({ label, value, tone, highlight, className }: CriterionBarProps) {
  const reduce = useReducedMotion();
  const t = tone ?? scoreTone(value);
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={cn("truncate label-m", highlight ? "text-on-surface" : "text-on-surface-variant")}>{label}</span>
        <span className={cn("label-l tabular-nums", toneText[t], highlight && "font-bold")}>{v > 0 ? `${Math.round(v)}%` : "—"}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest"
      >
        <motion.div
          className={cn("h-full rounded-full", toneBar[t])}
          initial={{ width: reduce ? `${v}%` : 0 }}
          animate={{ width: `${v}%` }}
          transition={{ duration: reduce ? 0 : duration.long1, ease: easing.emphasizedDecelerate }}
        />
      </div>
    </div>
  );
}
