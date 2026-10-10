import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Omit for a small dot badge. */
  count?: number;
  max?: number;
  /** Position absolutely at the top-right of a `relative` anchor. */
  overlay?: boolean;
}

/** M3 badge: small (dot) or large (with count). */
export function Badge({ count, max = 999, overlay = false, className, ...props }: BadgeProps) {
  const isDot = count === undefined;
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-error text-on-error tabular-nums",
        isDot ? "size-1.5" : "h-4 min-w-4 px-1 label-s",
        overlay && (isDot ? "absolute right-1 top-1" : "absolute -right-1.5 -top-1"),
        className,
      )}
      aria-label={isDot ? props["aria-label"] : props["aria-label"] ?? `${count} new`}
    >
      {isDot ? null : count! > max ? `${max}+` : count}
    </span>
  );
}
