"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu";

export interface SplitButtonAction {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
}

export interface SplitButtonProps {
  label: string;
  icon?: IconName;
  onClick: () => void;
  actions: SplitButtonAction[];
  variant?: "filled" | "tonal" | "outlined";
  disabled?: boolean;
  menuLabel?: string;
  className?: string;
}

const tone = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "border border-outline text-primary",
} as const;

/** M3 split button: primary action + trailing menu of related actions. */
export function SplitButton({
  label,
  icon,
  onClick,
  actions,
  variant = "filled",
  disabled,
  menuLabel = "More options",
  className,
}: SplitButtonProps) {
  const seg =
    "state-layer focus-ring relative inline-flex h-10 cursor-pointer items-center justify-center gap-2 overflow-hidden label-l transition-colors disabled:pointer-events-none disabled:bg-on-surface/12 disabled:text-on-surface/38";
  return (
    <div className={cn("inline-flex gap-0.5", className)}>
      <button type="button" onClick={onClick} disabled={disabled} className={cn(seg, tone[variant], "rounded-s-full rounded-e-xs ps-4 pe-4")}>
        {icon && <Icon name={icon} size={18} />}
        {label}
        <Ripple disabled={disabled} />
      </button>
      <Menu>
        <MenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={menuLabel}
            className={cn(seg, tone[variant], "group w-10 rounded-e-full rounded-s-xs data-[state=open]:rounded-full")}
          >
            <Icon name="keyboard_arrow_down" size={20} className="transition-transform group-data-[state=open]:rotate-180" />
            <Ripple disabled={disabled} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {actions.map((a) => (
            <MenuItem key={a.label} leadingIcon={a.icon} disabled={a.disabled} onSelect={a.onSelect}>
              {a.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  );
}
