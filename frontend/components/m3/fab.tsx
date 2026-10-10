"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";

export const fabVariants = cva(
  [
    "state-layer focus-ring relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-3 overflow-hidden",
    "elevation-3 hover:elevation-4 transition-[box-shadow,background-color] duration-150 ease-standard",
    "disabled:pointer-events-none disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
  ],
  {
    variants: {
      color: {
        primary: "bg-primary-container text-on-primary-container",
        secondary: "bg-secondary-container text-on-secondary-container",
        tertiary: "bg-tertiary-container text-on-tertiary-container",
        surface: "bg-surface-container-high text-primary",
      },
      size: {
        small: "size-10 rounded-md",
        default: "size-14 rounded-lg",
        large: "size-24 rounded-xl",
      },
      lowered: { true: "elevation-1 hover:elevation-2", false: "" },
    },
    defaultVariants: { color: "primary", size: "default", lowered: false },
  },
);

export interface FabProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color" | "children">,
    VariantProps<typeof fabVariants> {
  icon: IconName;
  label: string;
}

export const Fab = React.forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { className, color, size, lowered, icon, label, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(fabVariants({ color, size, lowered }), className)}
      {...props}
    >
      <Icon name={icon} size={size === "large" ? 36 : 24} />
      <Ripple disabled={disabled} />
    </button>
  );
});

export interface ExtendedFabProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    Omit<VariantProps<typeof fabVariants>, "size"> {
  icon?: IconName;
  /** Collapse to an icon-only FAB (e.g. while scrolling). */
  collapsed?: boolean;
}

export const ExtendedFab = React.forwardRef<HTMLButtonElement, ExtendedFabProps>(function ExtendedFab(
  { className, color, lowered, icon, collapsed = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        fabVariants({ color, lowered, size: "default" }),
        !collapsed && "w-auto min-w-20 px-4 label-l",
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} />}
      {collapsed ? <span className="sr-only">{children}</span> : <span className="pe-1">{children}</span>}
      <Ripple disabled={disabled} />
    </button>
  );
});
