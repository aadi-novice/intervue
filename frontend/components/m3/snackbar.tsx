"use client";

import * as React from "react";
import { Toast } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface SnackbarOptions {
  message: string;
  action?: { label: string; onClick: () => void };
  /** ms; defaults to 4000 (or 8000 with an action). */
  duration?: number;
  showClose?: boolean;
}

interface QueuedSnackbar extends SnackbarOptions {
  id: number;
}

interface SnackbarContextValue {
  show: (options: SnackbarOptions | string) => void;
}

const SnackbarContext = React.createContext<SnackbarContextValue | null>(null);

/** Provides a queued M3 snackbar (one visible at a time). */
export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<QueuedSnackbar[]>([]);
  const [open, setOpen] = React.useState(true);
  const nextId = React.useRef(0);
  const current = queue[0];

  const show = React.useCallback((options: SnackbarOptions | string) => {
    const opts = typeof options === "string" ? { message: options } : options;
    nextId.current += 1;
    const id = nextId.current;
    setQueue((q) => [...q, { ...opts, id }]);
  }, []);

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      // Let the exit animation play, then advance the queue.
      window.setTimeout(() => {
        setQueue((q) => q.slice(1));
        setOpen(true);
      }, 200);
    }
  };

  const value = React.useMemo(() => ({ show }), [show]);

  return (
    <SnackbarContext.Provider value={value}>
      <Toast.Provider swipeDirection="down" label="Notification">
        {children}
        {current && (
          <Toast.Root
            key={current.id}
            open={open}
            onOpenChange={handleOpenChange}
            duration={current.duration ?? (current.action ? 8000 : 4000)}
            className={cn(
              "flex min-h-12 w-full max-w-[560px] items-center gap-2 rounded-xs bg-inverse-surface py-1 pe-2 ps-4 text-inverse-on-surface elevation-3",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          >
            <Toast.Description className="flex-1 py-2 body-m">{current.message}</Toast.Description>
            {current.action && (
              <Toast.Action altText={current.action.label} asChild>
                <button
                  type="button"
                  onClick={current.action.onClick}
                  className="state-layer focus-ring relative h-10 rounded-full px-3 label-l text-inverse-primary"
                >
                  {current.action.label}
                </button>
              </Toast.Action>
            )}
            {current.showClose && (
              <Toast.Close
                aria-label="Dismiss"
                className="state-layer focus-ring relative flex size-10 items-center justify-center rounded-full"
              >
                <Icon name="close" size={20} />
              </Toast.Close>
            )}
          </Toast.Root>
        )}
        <Toast.Viewport className="fixed inset-x-4 bottom-24 z-[100] flex flex-col items-center outline-none medium:bottom-6" />
      </Toast.Provider>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = React.useContext(SnackbarContext);
  if (!ctx) throw new Error("useSnackbar must be used inside <SnackbarProvider>");
  return ctx;
}
