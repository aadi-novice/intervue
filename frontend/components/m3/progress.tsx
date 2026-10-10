import { cn } from "@/lib/utils";

export interface LinearProgressProps {
  /** 0–100. Omit for indeterminate. */
  value?: number;
  className?: string;
  /** Indicator colour token class (defaults to primary). */
  indicatorClassName?: string;
  "aria-label"?: string;
}

/** M3 linear progress indicator (determinate / indeterminate). */
export function LinearProgress({ value, className, indicatorClassName, ...aria }: LinearProgressProps) {
  const determinate = value !== undefined;
  const v = determinate ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(v) : undefined}
      aria-label={aria["aria-label"] ?? "Progress"}
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-secondary-container", className)}
    >
      {determinate ? (
        <div
          className={cn("h-full rounded-full bg-primary transition-[width] duration-500 ease-emphasized", indicatorClassName)}
          style={{ width: `${v}%` }}
        />
      ) : (
        <div className={cn("animate-m3-indeterminate absolute inset-y-0 rounded-full bg-primary", indicatorClassName)} />
      )}
    </div>
  );
}

export interface CircularProgressProps {
  value?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-label"?: string;
}

/** M3 circular progress indicator (determinate / indeterminate). */
export function CircularProgress({ value, size = 48, strokeWidth = 4, className, ...aria }: CircularProgressProps) {
  const determinate = value !== undefined;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const v = determinate ? Math.max(0, Math.min(100, value)) : 30;
  return (
    <svg
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(v) : undefined}
      aria-label={aria["aria-label"] ?? "Progress"}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("text-primary", !determinate && "animate-m3-spin", className)}
    >
      {determinate && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-secondary-container" />
      )}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (v / 100) * c}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-500 ease-emphasized"
      />
    </svg>
  );
}
