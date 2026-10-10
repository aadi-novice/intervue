"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";

export interface SearchBarProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerClassName?: string;
}

/** M3 search bar: 56px full-radius field with leading search icon and clear button. */
export const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { value, onValueChange, leading, trailing, containerClassName, className, placeholder = "Search", ...props },
  ref,
) {
  return (
    <div
      className={cn(
        "flex h-14 w-full items-center gap-1 rounded-full bg-surface-container-high ps-4 pe-2 text-on-surface-variant focus-within:outline-3 focus-within:outline-secondary",
        containerClassName,
      )}
    >
      {leading ?? <Icon name="search" />}
      <input
        ref={ref}
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={props["aria-label"] ?? placeholder}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent ps-3 body-l text-on-surface outline-none placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:hidden",
          className,
        )}
        {...props}
      />
      {value && <IconButton icon="close" label="Clear search" onClick={() => onValueChange("")} />}
      {trailing}
    </div>
  );
});

export interface SearchViewResult {
  id: string;
  headline: string;
  supporting?: string;
  icon?: IconName;
}

export interface SearchViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchViewResult[];
  onSelect: (result: SearchViewResult) => void;
  placeholder?: string;
  emptyText?: string;
}

/** M3 search view: full-screen (compact) / centred panel overlay with live results. */
export function SearchView({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  onSelect,
  placeholder = "Search",
  emptyText = "No results",
}: SearchViewProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim/32 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-surface-container-high text-on-surface outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 medium:inset-x-auto medium:left-1/2 medium:top-16 medium:bottom-auto medium:max-h-[70dvh] medium:w-[min(720px,92vw)] medium:-translate-x-1/2 medium:rounded-xl"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to search; use Tab to move through results.</DialogPrimitive.Description>
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-outline-variant px-2">
            <DialogPrimitive.Close asChild>
              <IconButton icon="arrow_back" label="Close search" />
            </DialogPrimitive.Close>
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent ps-2 body-l outline-none placeholder:text-on-surface-variant"
            />
            {query && <IconButton icon="close" label="Clear search" onClick={() => onQueryChange("")} />}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-2">
            {results.length === 0 && <li className="px-6 py-4 body-m text-on-surface-variant">{emptyText}</li>}
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  className="state-layer focus-ring relative flex min-h-14 w-full items-center gap-4 px-4 py-2 text-start"
                >
                  <Icon name={r.icon ?? "search"} className="text-on-surface-variant" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate body-l">{r.headline}</span>
                    {r.supporting && <span className="truncate body-m text-on-surface-variant">{r.supporting}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
