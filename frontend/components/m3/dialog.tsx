"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay =
  "fixed inset-0 z-50 bg-scrim/32 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export interface DialogContentProps extends Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  icon?: IconName;
  title: string;
  description?: string;
  /** Action buttons (right-aligned). */
  actions?: React.ReactNode;
  /** Full-screen on compact (<600px) windows. */
  fullScreenOnMobile?: boolean;
}

/** M3 basic dialog; becomes a full-screen dialog on compact windows when requested. */
export function DialogContent({
  icon,
  title,
  description,
  actions,
  fullScreenOnMobile = false,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] min-w-[280px] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-surface-container-high p-6 text-on-surface elevation-3 outline-none",
          "duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          fullScreenOnMobile &&
            "max-medium:left-0 max-medium:top-0 max-medium:h-full max-medium:max-h-none max-medium:w-full max-medium:max-w-none max-medium:translate-x-0 max-medium:translate-y-0 max-medium:rounded-none",
          className,
        )}
        {...props}
      >
        {fullScreenOnMobile && (
          <div className="mb-2 hidden items-center max-medium:flex">
            <DialogPrimitive.Close asChild>
              <IconButton icon="close" label="Close" />
            </DialogPrimitive.Close>
          </div>
        )}
        {icon && <Icon name={icon} className="mx-auto mb-4 text-secondary" />}
        <DialogPrimitive.Title className={cn("headline-s", icon && "text-center")}>{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-4 body-m text-on-surface-variant">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        {children && <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
