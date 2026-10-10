"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Ripple } from "./ripple";

export function List({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col py-2", className)} {...props} />;
}

export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLLIElement>, "onClick"> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  headline: React.ReactNode;
  supporting?: React.ReactNode;
  selected?: boolean;
  /** Makes the row pressable (renders a button inside the li). */
  onPress?: () => void;
  /** Render the row as another element (e.g. next/link) with the given class + children. */
  render?: (props: { className: string; children: React.ReactNode }) => React.ReactElement;
}

/** M3 list item (1-3 lines) with state layer + ripple when interactive. */
export function ListItem({
  leading,
  trailing,
  headline,
  supporting,
  selected,
  onPress,
  render,
  className,
  ...props
}: ListItemProps) {
  const inner = (
    <>
      {leading && <span className="flex shrink-0 items-center text-on-surface-variant">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate body-l text-on-surface">{headline}</span>
        {supporting && <span className="line-clamp-2 body-m text-on-surface-variant">{supporting}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center label-s text-on-surface-variant">{trailing}</span>}
    </>
  );
  const rowClass = cn(
    "flex min-h-14 w-full items-center gap-4 px-4 py-2 text-start",
    (onPress || render) && "state-layer focus-ring relative cursor-pointer overflow-hidden",
    selected && "bg-secondary-container text-on-secondary-container",
  );
  let row: React.ReactNode = <div className={rowClass}>{inner}</div>;
  if (render) {
    row = render({
      className: rowClass,
      children: (
        <>
          {inner}
          <Ripple />
        </>
      ),
    });
  } else if (onPress) {
    row = (
      <button type="button" onClick={onPress} aria-current={selected || undefined} className={rowClass}>
        {inner}
        <Ripple />
      </button>
    );
  }
  return (
    <li className={className} {...props}>
      {row}
    </li>
  );
}
