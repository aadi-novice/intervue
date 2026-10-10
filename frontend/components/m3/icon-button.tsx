"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";

export const iconButtonVariants = cva(
  [
    "state-layer focus-ring relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center overflow-hidden rounded-full",
    "transition-colors duration-150 ease-standard disabled:pointer-events-none disabled:text-on-surface/38",
  ],
  {
    variants: {
      variant: {
        standard: "text-on-surface-variant data-[selected=true]:text-primary",
        filled:
          "bg-primary text-on-primary data-[selected=false]:bg-surface-container-highest data-[selected=false]:text-primary disabled:bg-on-surface/12",
        tonal:
          "bg-secondary-container text-on-secondary-container data-[selected=false]:bg-surface-container-highest data-[selected=false]:text-on-surface-variant disabled:bg-on-surface/12",
        outlined:
          "border border-outline text-on-surface-variant data-[selected=true]:border-transparent data-[selected=true]:bg-inverse-surface data-[selected=true]:text-inverse-on-surface disabled:border-on-surface/12",
      },
      size: {
        sm: "size-8",
        md: "size-10",
        lg: "size-12",
      },
    },
    defaultVariants: { variant: "standard", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  icon: IconName;
  /** Accessible name (required — icon buttons have no visible text). */
  label: string;
  /** Toggle mode: when defined the button exposes aria-pressed. */
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  asChild?: boolean;
  children?: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, icon, label, selected, onSelectedChange, onClick, asChild, disabled, children, ...props },
  ref,
) {
  const isToggle = selected !== undefined;
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-label={label}
      title={label}
      aria-pressed={isToggle ? selected : undefined}
      data-selected={isToggle ? String(selected) : undefined}
      disabled={asChild ? undefined : disabled}
      className={cn(iconButtonVariants({ variant, size }), className)}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (isToggle) onSelectedChange?.(!selected);
      }}
      {...props}
    >
      <Icon name={icon} filled={isToggle ? selected : false} size={size === "sm" ? 20 : 24} />
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : null}
      <Ripple disabled={disabled} />
    </Comp>
  );
});
