"use client";

import * as React from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

interface BaseProps<V extends string> {
  options: SegmentOption<V>[];
  className?: string;
  density?: "default" | "compact";
  "aria-label"?: string;
}

interface SingleProps<V extends string> extends BaseProps<V> {
  multiple?: false;
  value: V;
  onValueChange: (value: V) => void;
}

interface MultiProps<V extends string> extends BaseProps<V> {
  multiple: true;
  value: V[];
  onValueChange: (value: V[]) => void;
}

export type SegmentedButtonProps<V extends string> = SingleProps<V> | MultiProps<V>;

/** M3 segmented button (2–5 segments), single or multi-select. */
export function SegmentedButton<V extends string>(props: SegmentedButtonProps<V>) {
  const { options, className, density = "default" } = props;
  const items = options.map((o) => {
    const selected = props.multiple ? props.value.includes(o.value) : props.value === o.value;
    return (
      <ToggleGroup.Item
        key={o.value}
        value={o.value}
        disabled={o.disabled}
        aria-label={o.label}
        className={cn(
          "state-layer focus-ring relative flex min-w-12 flex-1 cursor-pointer items-center justify-center gap-2 border border-outline px-3 label-l text-on-surface",
          "-ms-px first:ms-0 first:rounded-s-full last:rounded-e-full transition-colors duration-150",
          "data-[state=on]:bg-secondary-container data-[state=on]:text-on-secondary-container",
          "disabled:pointer-events-none disabled:border-on-surface/12 disabled:text-on-surface/38",
          density === "compact" ? "h-8" : "h-10",
        )}
      >
        {selected ? <Icon name="check" size={18} /> : o.icon ? <Icon name={o.icon} size={18} /> : null}
        <span className="truncate">{o.label}</span>
      </ToggleGroup.Item>
    );
  });

  if (props.multiple) {
    return (
      <ToggleGroup.Root
        type="multiple"
        value={props.value}
        onValueChange={(v) => props.onValueChange(v as V[])}
        aria-label={props["aria-label"]}
        className={cn("inline-flex", className)}
      >
        {items}
      </ToggleGroup.Root>
    );
  }
  return (
    <ToggleGroup.Root
      type="single"
      value={props.value}
      onValueChange={(v) => v && props.onValueChange(v as V)}
      aria-label={props["aria-label"]}
      className={cn("inline-flex", className)}
    >
      {items}
    </ToggleGroup.Root>
  );
}
