import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

export type ClaimStatus = "verified" | "unclear" | "contradicted";

const badge = cva("inline-flex h-6 items-center gap-1 rounded-sm px-2 label-m whitespace-nowrap", {
  variants: {
    status: {
      verified: "bg-match-strong-container text-on-match-strong-container",
      unclear: "bg-match-medium-container text-on-match-medium-container",
      contradicted: "bg-match-weak-container text-on-match-weak-container",
    },
  },
});

const META: Record<ClaimStatus, { label: string; icon: IconName }> = {
  verified: { label: "Verified", icon: "check_circle" },
  unclear: { label: "Unclear", icon: "help" },
  contradicted: { label: "Contradicted", icon: "error" },
};

/** Resume-claim check result chip. Never relies on colour alone (icon + label). */
export function ClaimCheckBadge({ status, className }: { status: ClaimStatus; className?: string }) {
  const m = META[status];
  return (
    <span className={cn(badge({ status }), className)}>
      <Icon name={m.icon} size={16} filled />
      {m.label}
    </span>
  );
}
