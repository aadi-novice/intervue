"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { stageTone } from "./tones";

export interface KanbanColumnProps {
  /** Stage id; selects the token colour. */
  stage: string;
  label: string;
  count: number;
  /** A drag is hovering this column. */
  isOver?: boolean;
  /** Ref for the droppable region (dnd-kit `setNodeRef`). */
  dropRef?: (node: HTMLElement | null) => void;
  className?: string;
  children?: React.ReactNode;
}

/** Presentational pipeline column: tonal header + droppable body with empty state. */
export function KanbanColumn({ stage, label, count, isOver, dropRef, className, children }: KanbanColumnProps) {
  const tone = stageTone(stage);
  return (
    <section
      aria-label={`${label}, ${count} candidates`}
      className={cn(
        "flex w-[260px] shrink-0 flex-col rounded-lg border-2 bg-surface-container-low transition-colors duration-150",
        isOver ? tone.ring : "border-transparent",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 rounded-full", tone.dot)} />
          <h2 className="title-s whitespace-nowrap text-on-surface">{label}</h2>
        </div>
        <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 label-m tabular-nums", tone.chip)}>
          {count}
        </span>
      </header>
      <div ref={dropRef} className="flex min-h-[160px] flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {children}
        {count === 0 && (
          <div
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed py-6 transition-colors",
              isOver ? cn(tone.ring, tone.text) : "border-outline-variant text-on-surface-variant",
            )}
          >
            <Icon name="add" size={20} />
            <p className="label-m">{isOver ? "Release to drop" : "Empty stage"}</p>
          </div>
        )}
      </div>
    </section>
  );
}
