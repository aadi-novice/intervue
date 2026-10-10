"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMotionPattern } from "@/app/theme/motion";
import { Icon, type IconName } from "./icon";

/** Staggered enter (30 ms per item, capped at 10). Spatial motion becomes opacity-only under reduced motion. */
export function StaggerItem({
  index,
  className,
  children,
  as = "div",
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "li" | "tr";
}) {
  const variants = useMotionPattern("staggerItem");
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp variants={variants} initial="initial" animate="animate" custom={index} className={className}>
      {children}
    </Comp>
  );
}

/** Page title block. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="headline-m text-on-surface">{title}</h1>
        {subtitle && <p className="mt-1 body-m text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Centered empty state. */
export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon: IconName;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <Icon name={icon} size={40} className="text-on-surface-variant" />
      <p className="title-m text-on-surface">{title}</p>
      {children && <div className="body-m text-on-surface-variant">{children}</div>}
    </div>
  );
}
