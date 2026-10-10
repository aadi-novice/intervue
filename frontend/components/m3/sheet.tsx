"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

interface SheetContentProps extends Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: string;
  showClose?: boolean;
}

const overlay =
  "fixed inset-0 z-50 bg-scrim/32 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

/** M3 bottom sheet (modal) with drag handle. */
export function BottomSheetContent({ title, showClose, className, children, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[640px] flex-col rounded-t-xl bg-surface-container-low text-on-surface elevation-1 outline-none",
          "duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto my-4 h-1 w-8 shrink-0 rounded-full bg-on-surface-variant/40" />
        <DialogPrimitive.Title className="px-6 title-l">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
        {showClose && (
          <DialogPrimitive.Close asChild>
            <IconButton icon="close" label="Close" className="absolute end-2 top-2" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** M3 side sheet (modal), end-aligned. */
export function SideSheetContent({ title, className, children, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex w-full max-w-[400px] flex-col rounded-s-xl bg-surface text-on-surface elevation-1 outline-none",
          "duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-2 p-4 ps-6">
          <DialogPrimitive.Title className="flex-1 title-l">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <IconButton icon="close" label="Close" />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
