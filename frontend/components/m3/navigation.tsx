"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { Badge } from "./badge";
import { Ripple } from "./ripple";

export interface NavDestination {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  badge?: number;
}

type LinkRender = (props: {
  href: string;
  className: string;
  children: React.ReactNode;
  "aria-current"?: "page";
}) => React.ReactElement;

interface NavCommon {
  destinations: NavDestination[];
  activeId: string;
  /** Renders a link element (pass a next/link wrapper). */
  renderLink: LinkRender;
}

/* ── Navigation rail ───────────────────────────────────────────────────── */

export interface NavigationRailProps extends NavCommon {
  /** Slot above the destinations (menu button / FAB). */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function NavigationRail({ destinations, activeId, renderLink, header, footer, className }: NavigationRailProps) {
  return (
    <nav aria-label="Primary" className={cn("flex w-20 shrink-0 flex-col items-center gap-3 bg-surface py-3", className)}>
      {header && <div className="flex flex-col items-center gap-3 pb-2">{header}</div>}
      <ul className="flex flex-col items-center gap-3">
        {destinations.map((d) => {
          const active = d.id === activeId;
          return (
            <li key={d.id}>
              {renderLink({
                href: d.href,
                "aria-current": active ? "page" : undefined,
                className: "group focus-ring flex w-14 flex-col items-center gap-1 rounded-md outline-none",
                children: (
                  <>
                    <span
                      className={cn(
                        "state-layer relative flex h-8 w-14 items-center justify-center overflow-hidden rounded-full transition-colors duration-200",
                        active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                      )}
                    >
                      <Icon name={d.icon} filled={active} />
                      {d.badge ? <Badge count={d.badge} overlay className="right-2 top-0" /> : null}
                      <Ripple />
                    </span>
                    <span className={cn("label-m", active ? "text-on-surface" : "text-on-surface-variant")}>{d.label}</span>
                  </>
                ),
              })}
            </li>
          );
        })}
      </ul>
      {footer && <div className="mt-auto flex flex-col items-center gap-3">{footer}</div>}
    </nav>
  );
}

/* ── Navigation bar ────────────────────────────────────────────────────── */

export interface NavigationBarProps extends NavCommon {
  className?: string;
}

export function NavigationBar({ destinations, activeId, renderLink, className }: NavigationBarProps) {
  return (
    <nav aria-label="Primary" className={cn("flex h-20 w-full items-start justify-around bg-surface-container px-2 pt-3", className)}>
      {destinations.map((d) => {
        const active = d.id === activeId;
        return (
          <React.Fragment key={d.id}>
            {renderLink({
              href: d.href,
              "aria-current": active ? "page" : undefined,
              className: "group focus-ring flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md outline-none",
              children: (
                <>
                  <span
                    className={cn(
                      "state-layer relative flex h-8 w-16 items-center justify-center overflow-hidden rounded-full transition-colors duration-200",
                      active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                    )}
                  >
                    <Icon name={d.icon} filled={active} />
                    {d.badge ? <Badge count={d.badge} overlay className="right-3 top-0" /> : null}
                    <Ripple />
                  </span>
                  <span className={cn("max-w-full truncate label-m", active ? "text-on-surface" : "text-on-surface-variant")}>
                    {d.label}
                  </span>
                </>
              ),
            })}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/* ── Navigation drawer (modal) ─────────────────────────────────────────── */

export interface NavigationDrawerProps extends NavCommon {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headline?: React.ReactNode;
  footer?: React.ReactNode;
  onNavigate?: () => void;
}

export function NavigationDrawer({
  open,
  onOpenChange,
  destinations,
  activeId,
  renderLink,
  headline,
  footer,
  onNavigate,
}: NavigationDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim/32 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 start-0 z-50 flex w-[360px] max-w-[85vw] flex-col rounded-e-xl bg-surface-container-low p-3 text-on-surface elevation-1 outline-none duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left"
        >
          <DialogPrimitive.Title className="px-4 py-6 title-s text-on-surface-variant">{headline ?? "Navigation"}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Primary navigation</DialogPrimitive.Description>
          <nav aria-label="Primary" className="flex-1 overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {destinations.map((d) => {
                const active = d.id === activeId;
                return (
                  <li key={d.id} onClick={onNavigate}>
                    {renderLink({
                      href: d.href,
                      "aria-current": active ? "page" : undefined,
                      className: cn(
                        "state-layer focus-ring relative flex h-14 items-center gap-3 overflow-hidden rounded-full ps-4 pe-6 label-l outline-none transition-colors",
                        active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                      ),
                      children: (
                        <>
                          <Icon name={d.icon} filled={active} />
                          <span className="flex-1">{d.label}</span>
                          {d.badge ? <span className="label-l tabular-nums">{d.badge}</span> : null}
                          <Ripple />
                        </>
                      ),
                    })}
                  </li>
                );
              })}
            </ul>
          </nav>
          {footer && <div className="pt-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
