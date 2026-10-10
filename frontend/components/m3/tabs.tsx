"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Ripple } from "./ripple";

type Variant = "primary" | "secondary";
const VariantContext = React.createContext<Variant>("primary");

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: Variant }) {
  return (
    <VariantContext.Provider value={variant}>
      <TabsPrimitive.List
        className={cn("flex w-full overflow-x-auto border-b border-outline-variant bg-surface", className)}
        {...props}
      />
    </VariantContext.Provider>
  );
}

export function TabsTrigger({
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { icon?: IconName }) {
  const variant = React.useContext(VariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "state-layer focus-ring group relative flex min-w-0 flex-1 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden px-4 outline-none transition-colors",
        variant === "primary" ? (icon ? "h-16 flex-col gap-0.5" : "h-12") : "h-12",
        "label-l text-on-surface-variant data-[state=active]:text-primary",
        variant === "secondary" && "data-[state=active]:text-on-surface",
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={24} />}
      <span className="truncate">{children}</span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 bg-primary opacity-0 transition-opacity duration-200 group-data-[state=active]:opacity-100",
          variant === "primary" ? "mx-auto h-[3px] w-[calc(100%-1rem)] max-w-full rounded-t-full" : "h-0.5",
        )}
      />
      <Ripple />
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none focus-visible:outline-none", className)} {...props} />;
}
