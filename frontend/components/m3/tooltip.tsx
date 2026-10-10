"use client";

import * as React from "react";
import { Popover, Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface PlainTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}

/** M3 plain tooltip (short label, inverse surface). */
export function PlainTooltip({ content, children, side = "bottom" }: PlainTooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className="z-50 max-w-[200px] rounded-xs bg-inverse-surface px-2 py-1 body-s text-inverse-on-surface data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export interface RichTooltipProps {
  title?: string;
  content: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * M3 rich tooltip: subhead + supporting text + optional action. Persistent
 * (click/keyboard-activated) so actions inside are reachable.
 */
export function RichTooltip({ title, content, action, children, side = "bottom", className }: RichTooltipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          sideOffset={4}
          className={cn(
            "z-50 max-w-[312px] rounded-md bg-surface-container px-4 pb-2 pt-3 text-on-surface-variant elevation-2 outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            className,
          )}
        >
          {title && <p className="mb-1 title-s text-on-surface-variant">{title}</p>}
          <div className="body-m">{content}</div>
          {action && (
            <div className="mt-2 -ms-3">
              <Popover.Close asChild>
                <button
                  type="button"
                  onClick={action.onClick}
                  className="state-layer focus-ring relative h-10 rounded-full px-3 label-l text-primary"
                >
                  {action.label}
                </button>
              </Popover.Close>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
