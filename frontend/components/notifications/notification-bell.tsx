"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { Button, Icon, Skeleton, useSnackbar } from "@/components/m3";
import type { AppNotification } from "@/lib/api-compliance";
import { notificationKindMeta, relativeTime, safeInternalLink } from "@/lib/compliance-logic";
import { errorMessage } from "@/lib/queries/auth";
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from "@/lib/queries/compliance";
import { cn } from "@/lib/utils";

export function NotificationItem({
  n,
  now,
  onOpen,
}: {
  n: AppNotification;
  now?: number;
  onOpen: (n: AppNotification) => void;
}) {
  const meta = notificationKindMeta(n.kind);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="state-layer focus-ring relative flex w-full items-start gap-3 px-4 py-3 text-start"
      >
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
            n.kind === "bot_failed" ? "bg-error-container text-on-error-container" : "bg-secondary-container text-on-secondary-container",
          )}
        >
          <Icon name={meta.icon} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="sr-only">{meta.label}: </span>
          <span className={cn("block truncate title-s", n.read ? "text-on-surface-variant" : "text-on-surface")}>{n.title}</span>
          {n.body && <span className="line-clamp-2 block body-s text-on-surface-variant">{n.body}</span>}
          <span className="mt-0.5 block label-s text-on-surface-variant">{relativeTime(n.created_at, now)}</span>
        </span>
        {!n.read && (
          <>
            <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">Unread</span>
          </>
        )}
      </button>
    </li>
  );
}

/** Announce newly arrived unread notifications (not the ones present on first load). */
function useNewItemAnnouncement(items: AppNotification[] | undefined): string {
  const seen = React.useRef<Set<number> | null>(null);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !i.read && !seen.current!.has(i.id));
    for (const i of items) seen.current.add(i.id);
    if (fresh.length === 0) return;
    setMessage(fresh.length === 1 ? `New notification: ${fresh[0].title}` : `${fresh.length} new notifications`);
  }, [items]);
  return message;
}

export function NotificationBell() {
  const router = useRouter();
  const snackbar = useSnackbar();
  const [open, setOpen] = React.useState(false);
  const unread = useUnreadCount();
  const count = unread.data ?? 0;
  const list = useNotifications(true);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const announcement = useNewItemAnnouncement(list.data);

  // A changed unread count means something arrived or was read elsewhere: refresh the list.
  const prevCount = React.useRef<number | null>(null);
  const { refetch } = list;
  React.useEffect(() => {
    if (unread.data == null) return;
    if (prevCount.current !== null && prevCount.current !== unread.data) void refetch();
    prevCount.current = unread.data;
  }, [unread.data, refetch]);

  const items = list.data ?? [];

  const openItem = (n: AppNotification) => {
    const href = safeInternalLink(n.link);
    setOpen(false);
    const go = () => {
      if (href) router.push(href);
    };
    if (n.read) return go();
    markRead.mutate(n.id, { onError: (e) => snackbar.show(errorMessage(e)), onSettled: go });
  };

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
            className="state-layer focus-ring relative inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-surface-variant"
          >
            <Icon name="notifications" filled={count > 0} />
            {count > 0 && (
              <span
                aria-hidden
                data-testid="unread-badge"
                className="absolute end-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 label-s tabular-nums text-on-error"
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            aria-label="Notifications"
            className="z-50 flex max-h-[min(32rem,80dvh)] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-md bg-surface-container text-on-surface elevation-2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-2">
              <h2 className="title-m">Notifications</h2>
              <Button
                variant="text"
                size="sm"
                disabled={count === 0 || markAll.isPending}
                onClick={() => markAll.mutate(undefined, { onError: (e) => snackbar.show(errorMessage(e)) })}
              >
                Mark all read
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.isLoading ? (
                <div role="status" aria-busy="true" className="space-y-3 p-4">
                  <span className="sr-only">Loading notifications</span>
                  <Skeleton className="h-12 rounded-md" />
                  <Skeleton className="h-12 rounded-md" />
                  <Skeleton className="h-12 rounded-md" />
                </div>
              ) : list.isError ? (
                <div role="alert" className="space-y-2 p-4 body-m text-on-surface-variant">
                  <p>{errorMessage(list.error)}</p>
                  <Button variant="tonal" size="sm" onClick={() => void list.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <Icon name="notifications_off" size={36} className="text-on-surface-variant" />
                  <p className="title-s">You&apos;re all caught up</p>
                  <p className="body-s text-on-surface-variant">New activity such as finished analyses and exports shows up here.</p>
                </div>
              ) : (
                <ul aria-label="Notification list" className="divide-y divide-outline-variant">
                  {items.map((n) => (
                    <NotificationItem key={n.id} n={n} onOpen={openItem} />
                  ))}
                </ul>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
