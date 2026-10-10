"use client";

import * as React from "react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuGroup = DropdownMenu.Group;
export const MenuSub = DropdownMenu.Sub;

const surface =
  "z-50 min-w-[112px] max-w-[280px] overflow-hidden rounded-xs bg-surface-container py-2 text-on-surface elevation-2 " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-200";

export function MenuContent({
  className,
  sideOffset = 4,
  align = "start",
  ...props
}: React.ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content sideOffset={sideOffset} align={align} className={cn(surface, className)} {...props} />
    </DropdownMenu.Portal>
  );
}

const itemClass =
  "relative flex h-12 w-full cursor-pointer select-none items-center gap-3 px-3 label-l text-on-surface outline-none " +
  "data-[highlighted]:bg-on-surface/8 data-[disabled]:pointer-events-none data-[disabled]:text-on-surface/38 transition-colors";

export interface MenuItemProps extends React.ComponentProps<typeof DropdownMenu.Item> {
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  trailingText?: string;
}

export function MenuItem({ className, leadingIcon, trailingIcon, trailingText, children, ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item className={cn(itemClass, className)} {...props}>
      {leadingIcon && <Icon name={leadingIcon} className="text-on-surface-variant" />}
      <span className="flex-1 truncate">{children}</span>
      {trailingText && <span className="body-m text-on-surface-variant">{trailingText}</span>}
      {trailingIcon && <Icon name={trailingIcon} className="text-on-surface-variant" />}
    </DropdownMenu.Item>
  );
}

export function MenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem className={cn(itemClass, className)} {...props}>
      <span className="flex size-6 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Icon name="check" size={20} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </DropdownMenu.CheckboxItem>
  );
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn(itemClass, className)} {...props}>
      <span className="flex size-6 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Icon name="check" size={20} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("px-3 py-2 label-m text-on-surface-variant", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("my-2 h-px bg-outline-variant", className)} {...props} />;
}
