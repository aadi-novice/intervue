"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";

export const buttonVariants = cva(
  [
    "state-layer focus-ring relative inline-flex shrink-0 select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full",
    "transition-[box-shadow,background-color,color] duration-150 ease-standard",
    "disabled:pointer-events-none aria-disabled:pointer-events-none cursor-pointer",
  ],
  {
    variants: {
      variant: {
        filled:
          "bg-primary text-on-primary hover:elevation-1 disabled:bg-on-surface/12 disabled:text-on-surface/38 aria-disabled:bg-on-surface/12 aria-disabled:text-on-surface/38",
        tonal:
          "bg-secondary-container text-on-secondary-container hover:elevation-1 disabled:bg-on-surface/12 disabled:text-on-surface/38 aria-disabled:bg-on-surface/12 aria-disabled:text-on-surface/38",
        outlined:
          "border border-outline text-primary disabled:border-on-surface/12 disabled:text-on-surface/38 aria-disabled:border-on-surface/12 aria-disabled:text-on-surface/38",
        text: "text-primary disabled:text-on-surface/38 aria-disabled:text-on-surface/38",
        elevated:
          "bg-surface-container-low text-primary elevation-1 hover:elevation-2 disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
        danger:
          "bg-error text-on-error hover:elevation-1 disabled:bg-on-surface/12 disabled:text-on-surface/38",
      },
      size: {
        sm: "h-8 px-4 label-l",
        md: "h-10 px-6 label-l",
        lg: "h-14 px-8 title-m",
      },
    },
    compoundVariants: [{ variant: "text", class: "px-3" }],
    defaultVariants: { variant: "filled", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next `<Link>`) with button styling. */
  asChild?: boolean;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon. */
  trailingIcon?: IconName;
  /** Shows an inline progress indicator and disables the button. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, icon, trailingIcon, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  const iconSize = size === "lg" ? 24 : 18;
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), (icon || loading) && "ps-4", className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="animate-m3-spin inline-block rounded-full border-2 border-current border-t-transparent"
          style={{ width: iconSize - 2, height: iconSize - 2 }}
        />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      <Slot.Slottable>{children}</Slot.Slottable>
      {trailingIcon && <Icon name={trailingIcon} size={iconSize} />}
      <Ripple disabled={disabled || loading} />
    </Comp>
  );
});
