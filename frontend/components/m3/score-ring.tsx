"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { duration, easing } from "@/app/theme/motion";
import { scoreTone, toneStroke, toneText, type MatchTone } from "./tones";

export interface ScoreRingProps {
  /** 0-100. */
  value: number;
  size?: number;
  /** Override the automatic tone derived from the value. */
  tone?: MatchTone;
  label?: string;
  className?: string;
}

/** Circular score indicator; colour follows the match-strong/medium/weak extension roles. */
export function ScoreRing({ value, size = 72, tone, label, className }: ScoreRingProps) {
  const reduce = useReducedMotion();
  const t = tone ?? scoreTone(value);
  const stroke = Math.max(4, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="img"
      aria-label={label ?? `Score ${Math.round(clamped)} out of 100`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-container-highest" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c - (clamped / 100) * c : c }}
          animate={{ strokeDashoffset: c - (clamped / 100) * c }}
          transition={{ duration: reduce ? 0 : duration.long2 * 2, ease: easing.emphasizedDecelerate }}
          className={toneStroke[t]}
        />
      </svg>
      <span
        aria-hidden
        className={cn("absolute font-medium tabular-nums", toneText[t])}
        style={{ fontSize: Math.max(11, size * 0.28) }}
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}
