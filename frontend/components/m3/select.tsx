"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

export interface SelectOption {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: "filled" | "outlined";
  leadingIcon?: IconName;
  supportingText?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
}

/** M3 select (exposed dropdown menu) built on Radix Select. */
export function Select({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  variant = "outlined",
  leadingIcon,
  supportingText,
  error,
  disabled,
  className,
  name,
}: SelectProps) {
  const id = React.useId();
  const [current, setCurrent] = React.useState(defaultValue ?? "");
  const shown = value ?? current;
  const selected = options.find((o) => o.value === shown);
  return (
    <div className={className}>
      <SelectPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => {
          setCurrent(v);
          onValueChange?.(v);
        }}
        disabled={disabled}
        name={name}
      >
        <SelectPrimitive.Trigger
          id={id}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          className={cn(
            "group relative flex min-h-14 w-full cursor-pointer items-center gap-2 px-4 text-start outline-none transition-colors disabled:pointer-events-none disabled:opacity-38",
            variant === "outlined"
              ? "rounded-xs border border-outline hover:border-on-surface focus-visible:border-2 focus-visible:border-primary data-[state=open]:border-2 data-[state=open]:border-primary"
              : "rounded-t-xs border-b border-on-surface-variant bg-surface-container-highest focus-visible:border-b-2 focus-visible:border-primary",
            error && "!border-error",
          )}
        >
          {leadingIcon && <Icon name={leadingIcon} className="text-on-surface-variant" />}
          <span className="relative min-w-0 flex-1">
            <span
              className={cn(
                "absolute start-0 truncate text-on-surface-variant transition-all",
                selected
                  ? variant === "outlined"
                    ? "-top-[1.65rem] bg-surface px-1 -ms-1 body-s"
                    : "-top-5 body-s"
                  : "top-0 body-l",
                "group-data-[state=open]:text-primary",
              )}
            >
              {label}
            </span>
            <span className={cn("block truncate body-l text-on-surface", variant === "filled" && "pt-4", !selected && "invisible")}>
              <SelectPrimitive.Value placeholder=" " />
            </span>
          </span>
          <SelectPrimitive.Icon asChild>
            <Icon name="arrow_drop_down" className="text-on-surface-variant transition-transform group-data-[state=open]:rotate-180" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xs bg-surface-container py-2 text-on-surface elevation-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            <SelectPrimitive.Viewport>
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="relative flex h-12 cursor-pointer select-none items-center gap-3 px-4 label-l outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-on-surface/8 data-[state=checked]:bg-secondary-container data-[state=checked]:text-on-secondary-container data-[disabled]:text-on-surface/38"
                >
                  {o.icon && <Icon name={o.icon} size={20} className="text-on-surface-variant" />}
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {(supportingText || error) && (
        <p className={cn("px-4 pt-1 body-s", error ? "text-error" : "text-on-surface-variant")} role={error ? "alert" : undefined}>
          {error ?? supportingText}
        </p>
      )}
    </div>
  );
}
