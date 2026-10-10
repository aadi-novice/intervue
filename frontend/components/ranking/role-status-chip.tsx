import { Icon, type IconName } from "@/components/m3";
import { cn } from "@/lib/utils";

const META: Record<string, { label: string; icon: IconName; className: string }> = {
  open: { label: "Open", icon: "radio_button_checked", className: "bg-match-strong-container text-on-match-strong-container" },
  paused: { label: "Paused", icon: "pause_circle", className: "bg-match-medium-container text-on-match-medium-container" },
  closed: { label: "Closed", icon: "lock", className: "bg-surface-container-highest text-on-surface-variant" },
};

/** Role status chip (icon + label; never colour alone). */
export function RoleStatusChip({ status, className }: { status: string; className?: string }) {
  const m = META[status] ?? META.open;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-sm px-2 label-m", m.className, className)}>
      <Icon name={m.icon} size={16} filled />
      {m.label}
    </span>
  );
}
