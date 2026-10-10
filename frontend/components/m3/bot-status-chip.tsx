"use client";

import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

export type BotStatus =
  | "scheduled"
  | "launching"
  | "joining"
  | "waiting_admission"
  | "in_call"
  | "leaving"
  | "processing"
  | "completed"
  | "failed";

interface Meta {
  label: string;
  icon: IconName;
  className: string;
  pulse?: boolean;
}

/** Joining → Waiting to be admitted → Recording → Processing → Done */
export const BOT_STATUS_META: Record<BotStatus, Meta> = {
  scheduled: { label: "Scheduled", icon: "schedule", className: "bg-surface-container-highest text-on-surface-variant" },
  launching: { label: "Joining", icon: "hourglass_top", className: "bg-secondary-container text-on-secondary-container", pulse: true },
  joining: { label: "Joining", icon: "login", className: "bg-secondary-container text-on-secondary-container", pulse: true },
  waiting_admission: {
    label: "Waiting to be admitted",
    icon: "hourglass_top",
    className: "bg-match-medium-container text-on-match-medium-container",
    pulse: true,
  },
  in_call: { label: "Recording", icon: "fiber_manual_record", className: "bg-error-container text-on-error-container", pulse: true },
  leaving: { label: "Leaving", icon: "logout", className: "bg-secondary-container text-on-secondary-container" },
  processing: { label: "Processing", icon: "sync", className: "bg-ai-container text-on-ai-container", pulse: true },
  completed: { label: "Done", icon: "check_circle", className: "bg-match-strong-container text-on-match-strong-container" },
  failed: { label: "Failed", icon: "error", className: "bg-error-container text-on-error-container" },
};

export interface BotStatusChipProps {
  status: BotStatus;
  className?: string;
}

/**
 * Notetaker bot status. Rendered inside an ARIA live region (role="status") so
 * status transitions are announced; colour change is animated.
 */
export function BotStatusChip({ status, className }: BotStatusChipProps) {
  const m = BOT_STATUS_META[status];
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-sm px-3 label-l whitespace-nowrap transition-colors duration-300 ease-standard",
        m.className,
        className,
      )}
    >
      <Icon
        name={m.icon}
        size={18}
        filled
        className={cn(m.pulse && status !== "processing" && "animate-pulse", status === "processing" && "animate-m3-spin")}
      />
      <span>
        <span className="sr-only">Notetaker status: </span>
        {m.label}
      </span>
    </span>
  );
}
