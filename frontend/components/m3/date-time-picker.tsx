"use client";

import * as React from "react";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { Button } from "./button";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export interface DatePickerPanelProps {
  value: Date | null;
  onChange: (date: Date) => void;
  min?: Date;
  max?: Date;
}

/** M3 date picker (docked calendar grid with month navigation). */
export function DatePickerPanel({ value, onChange, min, max }: DatePickerPanelProps) {
  const [view, setView] = React.useState(() => {
    const d = value ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [today] = React.useState(() => new Date());
  const first = view.getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1)),
  ];
  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  return (
    <div className="w-[328px] p-3">
      <div className="flex items-center justify-between pb-2">
        <IconButton icon="chevron_left" label="Previous month" onClick={() => shift(-1)} />
        <span className="title-s" aria-live="polite">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <IconButton icon="chevron_right" label="Next month" onClick={() => shift(1)} />
      </div>
      <div role="grid" aria-label={`${MONTHS[view.getMonth()]} ${view.getFullYear()}`} className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} role="columnheader" className="flex h-10 items-center justify-center body-s text-on-surface-variant">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const selected = !!value && sameDay(d, value);
          const disabled = (min && d < new Date(min.getFullYear(), min.getMonth(), min.getDate())) || (max && d > max);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={d.toDateString()}
              disabled={!!disabled}
              onClick={() => onChange(d)}
              className={cn(
                "state-layer focus-ring relative mx-auto flex size-10 items-center justify-center rounded-full body-m tabular-nums disabled:pointer-events-none disabled:text-on-surface/38",
                selected
                  ? "bg-primary text-on-primary"
                  : sameDay(d, today)
                    ? "border border-outline text-primary"
                    : "text-on-surface",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface TimePickerPanelProps {
  hours: number; // 0-23
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
  /** Minute step for the minute dial (default 5). */
  minuteStep?: number;
}

/** M3 time picker (input mode: hour / minute fields with AM/PM segmented toggle). */
export function TimePickerPanel({ hours, minutes, onChange, minuteStep = 5 }: TimePickerPanelProps) {
  const pm = hours >= 12;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const setH12 = (h: number) => onChange((h % 12) + (pm ? 12 : 0), minutes);
  const field =
    "h-20 w-24 rounded-sm bg-surface-container-highest text-center display-s tabular-nums text-on-surface outline-none focus:bg-primary-container focus:text-on-primary-container focus:outline-2 focus:outline-primary";
  return (
    <div className="flex items-center gap-3 p-4" role="group" aria-label="Time">
      <input
        aria-label="Hour"
        inputMode="numeric"
        className={field}
        value={String(h12).padStart(2, "0")}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "").slice(-2));
          if (n >= 1 && n <= 12) setH12(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setH12(h12 === 12 ? 1 : h12 + 1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setH12(h12 === 1 ? 12 : h12 - 1);
          }
        }}
      />
      <span className="display-s text-on-surface">:</span>
      <input
        aria-label="Minute"
        inputMode="numeric"
        className={field}
        value={String(minutes).padStart(2, "0")}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "").slice(-2));
          if (n >= 0 && n <= 59) onChange(hours, n);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(hours, (minutes + minuteStep) % 60);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(hours, (minutes - minuteStep + 60) % 60);
          }
        }}
      />
      <div role="radiogroup" aria-label="AM or PM" className="ms-2 flex h-20 w-14 flex-col overflow-hidden rounded-sm border border-outline">
        {(["AM", "PM"] as const).map((p) => {
          const on = (p === "PM") === pm;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(p === "PM" ? (hours % 12) + 12 : hours % 12, minutes)}
              className={cn(
                "state-layer focus-ring relative flex-1 title-m",
                on ? "bg-tertiary-container text-on-tertiary-container" : "text-on-surface-variant",
              )}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DateTimePickerProps {
  label: string;
  value: Date | null;
  onChange: (value: Date) => void;
  min?: Date;
  className?: string;
  error?: string;
}

const fmt = (d: Date) =>
  d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Date + time picker in a popover, for scheduling interviews. */
export function DateTimePicker({ label, value, onChange, min, className, error }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Date>(value ?? new Date(2000, 0, 1, 9, 0));
  const id = React.useId();

  const commit = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <div className={className}>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          if (o) setDraft(value ?? (() => { const n = new Date(); n.setMinutes(0, 0, 0); n.setHours(n.getHours() + 1); return n; })());
          setOpen(o);
        }}
      >
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            aria-label={label}
            className={cn(
              "group relative flex min-h-14 w-full cursor-pointer items-center gap-2 rounded-xs border border-outline px-4 text-start outline-none hover:border-on-surface focus-visible:border-2 focus-visible:border-primary data-[state=open]:border-2 data-[state=open]:border-primary",
              error && "!border-error",
            )}
          >
            <span className="relative min-w-0 flex-1">
              <span
                className={cn(
                  "absolute start-0 text-on-surface-variant transition-all",
                  value ? "-top-[1.65rem] bg-surface px-1 -ms-1 body-s" : "top-0 body-l",
                )}
              >
                {label}
              </span>
              <span className={cn("block truncate body-l text-on-surface", !value && "invisible")}>{value ? fmt(value) : " "}</span>
            </span>
            <Icon name="calendar_month" className="text-on-surface-variant" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 rounded-xl bg-surface-container-high text-on-surface elevation-3 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            <DatePickerPanel
              value={draft}
              min={min}
              onChange={(d) => {
                const n = new Date(draft);
                n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                setDraft(n);
              }}
            />
            <div className="border-t border-outline-variant">
              <TimePickerPanel
                hours={draft.getHours()}
                minutes={draft.getMinutes()}
                onChange={(h, m) => {
                  const n = new Date(draft);
                  n.setHours(h, m, 0, 0);
                  setDraft(n);
                }}
              />
            </div>
            <div className="flex justify-end gap-2 p-3 pt-0">
              <Popover.Close asChild>
                <Button variant="text">Cancel</Button>
              </Popover.Close>
              <Button variant="text" onClick={commit}>
                OK
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && (
        <p role="alert" className="px-4 pt-1 body-s text-error">
          {error}
        </p>
      )}
    </div>
  );
}
