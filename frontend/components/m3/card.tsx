"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Ripple } from "./ripple";

export const cardVariants = cva("relative block overflow-hidden rounded-md text-on-surface", {
  variants: {
    variant: {
      elevated: "bg-surface-container-low elevation-1",
      filled: "bg-surface-container-highest",
      outlined: "border border-outline-variant bg-surface",
    },
    interactive: {
      true: "state-layer focus-ring cursor-pointer text-left transition-shadow duration-150",
      false: "",
    },
  },
  compoundVariants: [{ variant: "elevated", interactive: true, class: "hover:elevation-2" }],
  defaultVariants: { variant: "filled", interactive: false },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    Omit<VariantProps<typeof cardVariants>, "interactive"> {
  /** Makes the card a focusable, pressable surface with state layer + ripple. */
  onPress?: () => void;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, onPress, children, onKeyDown, ...props },
  ref,
) {
  const interactive = !!onPress;
  return (
    <div
      ref={ref}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onPress}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (interactive && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onPress?.();
        }
      }}
      className={cn(cardVariants({ variant, interactive }), className)}
      {...props}
    >
      {children}
      {interactive && <Ripple />}
    </div>
  );
});
