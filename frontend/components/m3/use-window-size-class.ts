"use client";

import { useSyncExternalStore } from "react";

export type WindowSizeClass = "compact" | "medium" | "expanded" | "large" | "extra-large";

export function classify(width: number): WindowSizeClass {
  if (width < 600) return "compact";
  if (width < 840) return "medium";
  if (width < 1200) return "expanded";
  if (width < 1600) return "large";
  return "extra-large";
}

function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** M3 window size class (compact <600, medium 600-839, expanded 840-1199, large 1200-1599, extra-large >=1600). */
export function useWindowSizeClass(): WindowSizeClass {
  // Server + first client render assume "expanded" (rail layout) to avoid a mismatch flash on desktop.
  return useSyncExternalStore<WindowSizeClass>(
    subscribe,
    () => classify(window.innerWidth),
    () => "expanded",
  );
}
