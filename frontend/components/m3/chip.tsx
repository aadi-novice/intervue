"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";

const base =
  "state-layer focus-ring relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 overflow-hidden rounded-sm border px-3 label-l whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:border-on-surface/12 disabled:text-on-surface/38";

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export interface AssistChipProps extends ButtonProps {
  label: string;
  icon?: IconName;
  elevated?: boolean;
}

/** Assist chip: a smart/automated action (e.g. "Add to calendar"). */
export function AssistChip({ label, icon, elevated, className, ...props }: AssistChipProps) {
  return (
    <button
      type="button"
      className={cn(base, "text-on-surface", elevated ? "border-transparent bg-surface-container-low elevation-1" : "border-outline-variant", className)}
      {...props}
    >
      {icon && <Icon name={icon} size={18} className="text-primary" />}
      {label}
      <Ripple disabled={props.disabled} />
    </button>
  );
}

export interface FilterChipProps extends Omit<ButtonProps, "onChange"> {
  label: string;
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  icon?: IconName;
  /** Show a dropdown arrow (opens a menu for the filter). */
  dropdown?: boolean;
}

/** Filter chip: toggles a filter; shows a checkmark when selected. */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { label, selected, onSelectedChange, icon, dropdown, className, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role={dropdown ? undefined : "checkbox"}
      aria-checked={dropdown ? undefined : selected}
      aria-pressed={dropdown ? selected : undefined}
      onClick={(e) => {
        onClick?.(e);
        onSelectedChange?.(!selected);
      }}
      className={cn(
        base,
        selected ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface-variant",
        className,
      )}
      {...props}
    >
      {selected ? <Icon name="check" size={18} /> : icon ? <Icon name={icon} size={18} /> : null}
      {label}
      {dropdown && <Icon name="keyboard_arrow_down" size={18} />}
      <Ripple disabled={props.disabled} />
    </button>
  );
});

export interface InputChipProps {
  label: string;
  onRemove?: () => void;
  onPress?: () => void;
  icon?: IconName;
  className?: string;
  disabled?: boolean;
}

/** Input chip: a user-entered item (tag, recipient) with a remove button. */
export function InputChip({ label, onRemove, onPress, icon, className, disabled }: InputChipProps) {
  return (
    <span className={cn("inline-flex h-8 items-center overflow-hidden rounded-sm border border-outline-variant text-on-surface-variant", className)}>
      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        className="state-layer focus-ring relative flex h-full items-center gap-2 ps-3 pe-2 label-l disabled:text-on-surface/38"
      >
        {icon && <Icon name={icon} size={18} />}
        {label}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          disabled={disabled}
          className="state-layer focus-ring relative flex h-full items-center pe-2 ps-0.5 disabled:text-on-surface/38"
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </span>
  );
}

export interface SuggestionChipProps extends ButtonProps {
  label: string;
  icon?: IconName;
}

/** Suggestion chip: dynamically generated suggestion (e.g. skill suggestions). */
export function SuggestionChip({ label, icon, className, ...props }: SuggestionChipProps) {
  return (
    <button type="button" className={cn(base, "border-outline-variant text-on-surface-variant", className)} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {label}
      <Ripple disabled={props.disabled} />
    </button>
  );
}
