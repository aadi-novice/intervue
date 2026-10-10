"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive, Switch as SwitchPrimitive, Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/* Shared 40px touch target with a state-layer halo. */
const halo =
  "relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none " +
  "before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity " +
  "hover:before:opacity-8 focus-visible:before:opacity-10 focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-0 " +
  "disabled:pointer-events-none disabled:opacity-38";

export interface CheckboxProps extends Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "children"> {
  label?: React.ReactNode;
  error?: boolean;
}

export function Checkbox({ label, error, className, id, ...props }: CheckboxProps) {
  const autoId = React.useId();
  const cid = id ?? autoId;
  const box = (
    <CheckboxPrimitive.Root
      id={cid}
      className={cn(halo, error ? "text-error" : "text-primary", "group", className)}
      {...props}
    >
      <span
        className={cn(
          "relative flex size-[18px] items-center justify-center rounded-[2px] border-2 transition-colors",
          error ? "border-error" : "border-on-surface-variant",
          "group-data-[state=checked]:border-transparent group-data-[state=indeterminate]:border-transparent",
          error ? "group-data-[state=checked]:bg-error group-data-[state=indeterminate]:bg-error" : "group-data-[state=checked]:bg-primary group-data-[state=indeterminate]:bg-primary",
        )}
      >
        <CheckboxPrimitive.Indicator className={error ? "text-on-error" : "text-on-primary"}>
          <Icon name={props.checked === "indeterminate" ? "remove" : "check"} size={16} className="font-bold" />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-center">
      {box}
      <label htmlFor={cid} className="cursor-pointer body-m text-on-surface">
        {label}
      </label>
    </div>
  );
}

export const RadioGroup = ({ className, ...props }: React.ComponentProps<typeof RadioPrimitive.Root>) => (
  <RadioPrimitive.Root className={cn("flex flex-col", className)} {...props} />
);

export function Radio({
  label,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<typeof RadioPrimitive.Item>, "children"> & { label?: React.ReactNode }) {
  const autoId = React.useId();
  const rid = id ?? autoId;
  return (
    <div className="flex items-center">
      <RadioPrimitive.Item id={rid} className={cn(halo, "group text-primary", className)} {...props}>
        <span className="flex size-5 items-center justify-center rounded-full border-2 border-on-surface-variant transition-colors group-data-[state=checked]:border-primary">
          <RadioPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
        </span>
      </RadioPrimitive.Item>
      {label && (
        <label htmlFor={rid} className="cursor-pointer body-m text-on-surface">
          {label}
        </label>
      )}
    </div>
  );
}

export function Switch({
  label,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "children"> & { label?: React.ReactNode }) {
  const autoId = React.useId();
  const sid = id ?? autoId;
  const sw = (
    <SwitchPrimitive.Root
      id={sid}
      className={cn(
        "group state-layer focus-ring relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 outline-none",
        "border-outline bg-surface-container-highest data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "disabled:pointer-events-none disabled:opacity-38",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none flex items-center justify-center rounded-full bg-outline transition-all duration-200 ease-emphasized",
          "size-4 translate-x-1.5 data-[state=checked]:size-6 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-primary",
        )}
      >
        <Icon name="check" size={16} className="text-on-primary-container opacity-0 group-data-[state=checked]:opacity-100" />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
  if (!label) return sw;
  return (
    <div className="flex items-center gap-4">
      <label htmlFor={sid} className="flex-1 cursor-pointer body-l text-on-surface">
        {label}
      </label>
      {sw}
    </div>
  );
}

export interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** Show the value label above the handle while dragging/focused. */
  showValueLabel?: boolean;
}

export function Slider({ className, showValueLabel = true, value, defaultValue, ...props }: SliderProps) {
  const values = value ?? defaultValue ?? [0];
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-10 w-full touch-none select-none items-center", className)}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-4 grow overflow-hidden rounded-full bg-secondary-container">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((v, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={props["aria-label"] ?? "Value"}
          className="group focus-ring block h-11 w-1 rounded-full bg-primary outline-none transition-[width] hover:bg-primary focus-visible:w-0.5 disabled:pointer-events-none"
        >
          {showValueLabel && (
            <span className="pointer-events-none absolute -top-9 left-1/2 hidden h-7 min-w-7 -translate-x-1/2 items-center justify-center rounded-full bg-inverse-surface px-2 label-m tabular-nums text-inverse-on-surface group-hover:flex group-focus-visible:flex group-active:flex">
              {v}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  );
}
