"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TopAppBarProps {
  variant?: "small" | "medium" | "large";
  title: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Extra content between title and trailing actions (e.g. a search field). */
  children?: React.ReactNode;
  /**
   * Scroll container to observe for the "on scroll" container colour change and
   * (medium/large) title collapse. Defaults to the window.
   */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /** Element used for the title (use "p" when the page has its own h1). */
  titleAs?: "h1" | "p";
  /** Hide the small-bar title below the medium breakpoint. */
  hideTitleOnCompact?: boolean;
  className?: string;
}

/** M3 top app bar: small / medium / large. Medium+large collapse to small on scroll. */
export function TopAppBar({
  variant = "small",
  title,
  leading,
  trailing,
  children,
  scrollRef,
  titleAs = "h1",
  hideTitleOnCompact = false,
  className,
}: TopAppBarProps) {
  const Title = titleAs;
  const [scrolled, setScrolled] = React.useState(false);
  const [collapse, setCollapse] = React.useState(0); // 0..1

  React.useEffect(() => {
    const el = scrollRef?.current ?? null;
    const maxCollapse = variant === "large" ? 64 : variant === "medium" ? 40 : 0;
    const read = () => {
      const top = el ? el.scrollTop : window.scrollY;
      setScrolled(top > 0);
      setCollapse(maxCollapse ? Math.min(1, top / maxCollapse) : 0);
    };
    read();
    const target: HTMLElement | Window = el ?? window;
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, [scrollRef, variant]);

  const expandedHeight = variant === "large" ? 152 : variant === "medium" ? 112 : 64;
  const height = 64 + (expandedHeight - 64) * (1 - collapse);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex w-full flex-col justify-between px-4 text-on-surface transition-colors duration-200",
        scrolled ? "bg-surface-container" : "bg-surface",
        className,
      )}
      style={{ height }}
    >
      <div className="flex h-16 shrink-0 items-center gap-1">
        {leading}
        {variant === "small" || collapse >= 1 ? (
          <Title className={cn("min-w-0 truncate ps-2 title-l", hideTitleOnCompact && "max-medium:hidden")}>{title}</Title>
        ) : (
          <span className="flex-1" />
        )}
        {children && <div className="min-w-0 flex-1">{children}</div>}
        {variant === "small" && !children && <span className="flex-1" />}
        {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
      </div>
      {variant !== "small" && (
        <h1
          className={cn(
            "truncate pb-5 ps-2 transition-opacity",
            variant === "large" ? "headline-m" : "headline-s",
          )}
          style={{ opacity: 1 - collapse, pointerEvents: collapse >= 1 ? "none" : undefined }}
          aria-hidden={collapse >= 1}
        >
          {title}
        </h1>
      )}
    </header>
  );
}
