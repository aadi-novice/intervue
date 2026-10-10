import type { MaterialSymbol } from "@material-symbols/font-400";
import { cn } from "@/lib/utils";

export type IconName = MaterialSymbol;

export interface IconProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Material Symbols Rounded ligature name, e.g. "search". */
  name: IconName;
  /** Toggle the variable font FILL axis (use for active/selected states). */
  filled?: boolean;
  /** Size in px (default 24). */
  size?: number;
  /** Accessible label. When omitted the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, filled = false, size = 24, label, className, style, ...props }: IconProps) {
  return (
    <span
      {...props}
      className={cn("material-symbol", className)}
      style={
        {
          fontSize: size,
          width: size,
          height: size,
          "--icon-fill": filled ? 1 : 0,
          ...style,
        } as React.CSSProperties
      }
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}
