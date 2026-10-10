import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const avatarVariants = cva("relative inline-flex shrink-0 items-center justify-center overflow-hidden font-medium", {
  variants: {
    size: {
      sm: "size-8 label-m",
      md: "size-10 label-l",
      lg: "size-12 title-m",
      xl: "size-16 title-l",
    },
    shape: { circle: "rounded-full", rounded: "rounded-md" },
  },
  defaultVariants: { size: "md", shape: "circle" },
});

const PALETTE = [
  "bg-primary-container text-on-primary-container",
  "bg-secondary-container text-on-secondary-container",
  "bg-tertiary-container text-on-tertiary-container",
  "bg-ai-container text-on-ai-container",
  "bg-match-strong-container text-on-match-strong-container",
  "bg-match-medium-container text-on-match-medium-container",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export interface CandidateAvatarProps extends VariantProps<typeof avatarVariants> {
  name: string;
  /** Pre-computed initials (e.g. from the API); derived from the name otherwise. */
  initials?: string;
  src?: string | null;
  className?: string;
}

/** Candidate avatar: photo, or initials on a deterministic tonal container. */
export function CandidateAvatar({ name, initials, src, size, shape, className }: CandidateAvatarProps) {
  return (
    <span
      className={cn(avatarVariants({ size, shape }), !src && PALETTE[hash(name) % PALETTE.length], className)}
      role="img"
      aria-label={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials || initialsOf(name)}</span>
      )}
    </span>
  );
}
