import { cn } from "@/lib/utils";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  /** Inset by 16px at the start (list dividers). */
  inset?: boolean;
  className?: string;
}

export function Divider({ orientation = "horizontal", inset, className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-outline-variant",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        inset && "ms-4 w-auto",
        className,
      )}
    />
  );
}
