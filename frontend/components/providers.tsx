"use client";

import { MotionConfig } from "framer-motion";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { ThemeProvider } from "@/components/theme-provider";
import { SnackbarProvider } from "@/components/m3/snackbar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {/* `reducedMotion="user"` disables transform/layout animation when the OS asks. */}
      <MotionConfig reducedMotion="user">
        <TooltipPrimitive.Provider delayDuration={400}>
          <SnackbarProvider>{children}</SnackbarProvider>
        </TooltipPrimitive.Provider>
      </MotionConfig>
    </ThemeProvider>
  );
}
