"use client";

import * as React from "react";
import { Button, Card, Dialog, DialogContent, Icon, IconButton, Skeleton, LoadingRegion, useSnackbar } from "@/components/m3";
import { cn } from "@/lib/utils";
import {
  curlExample,
  revealTitle,
  revealWarning,
  VERIFY_NODE,
  VERIFY_PYTHON,
  type Reveal,
} from "@/lib/integrations-logic";

/** Copies text and confirms with a snackbar; falls back to a hidden textarea where the Clipboard API is unavailable. */
export function useCopy() {
  const snackbar = useSnackbar();
  return React.useCallback(
    async (text: string, what = "Copied") => {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        snackbar.show(`${what} to clipboard`);
      } catch {
        snackbar.show("Couldn't copy automatically. Select the text and copy it manually.");
      }
    },
    [snackbar],
  );
}

export function CodeBlock({ label, code, className }: { label: string; code: string; className?: string }) {
  const copy = useCopy();
  return (
    <div className={cn("rounded-md bg-surface-container-highest", className)}>
      <div className="flex items-center justify-between ps-3 pe-1">
        <span className="label-m text-on-surface-variant">{label}</span>
        <IconButton icon="content_copy" size="sm" label={`Copy ${label}`} onClick={() => copy(code, label)} />
      </div>
      <pre tabIndex={0} className="focus-ring overflow-x-auto px-3 pb-3 font-mono text-xs leading-5 text-on-surface">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Status pill using design-token containers only. */
export function StatusPill({ tone, children }: { tone: "success" | "warning" | "error" | "neutral"; children: React.ReactNode }) {
  const cls = {
    success: "bg-match-strong-container text-on-match-strong-container",
    warning: "bg-match-medium-container text-on-match-medium-container",
    error: "bg-error-container text-on-error-container",
    neutral: "bg-surface-container-highest text-on-surface-variant",
  }[tone];
  return <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", cls)}>{children}</span>;
}

export function EventChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-sm border border-outline-variant px-2 label-s text-on-surface-variant">
      {label}
    </span>
  );
}

export function SectionSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="space-y-3">
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
    </LoadingRegion>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card variant="outlined" className="p-5">
      <p role="alert" className="body-m text-error">
        {message}
      </p>
      <Button className="mt-3" variant="tonal" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

export function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="title-l text-on-surface">
          {title}
        </h2>
        <p className="body-m text-on-surface-variant">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        icon={icon}
        title={title}
        description={description}
        actions={
          <>
            <Button variant="text" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

/**
 * One-time reveal of a webhook secret or API key. The parent holds the value only while this dialog is open and
 * clears it on close; clicking outside does not dismiss it so it can't be lost by accident.
 */
export function RevealDialog({ reveal, onClose }: { reveal: Reveal | null; onClose: () => void }) {
  const copy = useCopy();
  const value = reveal ? (reveal.kind === "apikey" ? reveal.key : reveal.secret) : "";
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  return (
    <Dialog open={reveal != null} onOpenChange={(o) => !o && onClose()}>
      {reveal && (
        <DialogContent
          icon="key"
          title={revealTitle(reveal)}
          fullScreenOnMobile
          onInteractOutside={(e) => e.preventDefault()}
          className="max-w-[640px]"
          actions={
            <Button onClick={onClose}>I&apos;ve saved it</Button>
          }
        >
          <div className="space-y-4">
            <p role="alert" className="flex items-start gap-2 rounded-md bg-error-container p-3 body-m text-on-error-container">
              <Icon name="warning" size={20} />
              <span>{revealWarning(reveal.kind)}</span>
            </p>
            <div className="flex items-center gap-2 rounded-md bg-surface-container-highest p-2 ps-3">
              <code data-testid="revealed-value" className="min-w-0 flex-1 break-all font-mono text-sm text-on-surface">
                {value}
              </code>
              <Button variant="tonal" size="sm" icon="content_copy" onClick={() => copy(value, reveal.kind === "apikey" ? "API key copied" : "Secret copied")}>
                Copy
              </Button>
            </div>
            {reveal.kind === "apikey" ? (
              <CodeBlock label="Example request" code={curlExample(value, origin)} />
            ) : (
              <div className="space-y-3">
                <p className="body-s text-on-surface-variant">
                  Verify every delivery: the <code>X-Intervue-Signature</code> header is{" "}
                  <code>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where <code>v1</code> is the HMAC-SHA256 of{" "}
                  <code>&quot;&lt;t&gt;.&quot; + raw request body</code> with this secret. Use the raw body bytes and reject timestamps older
                  than 5 minutes. More in docs/INTEGRATIONS.md.
                </p>
                <CodeBlock label="Python example" code={VERIFY_PYTHON} />
                <CodeBlock label="Node example" code={VERIFY_NODE} />
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
