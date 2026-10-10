"use client";

import { useState } from "react";
import { MotionConfig } from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { ThemeProvider } from "@/components/theme-provider";
import { SnackbarProvider } from "@/components/m3/snackbar";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* `reducedMotion="user"` disables transform/layout animation when the OS asks. */}
        <MotionConfig reducedMotion="user">
          <TooltipPrimitive.Provider delayDuration={400}>
            <SnackbarProvider>{children}</SnackbarProvider>
          </TooltipPrimitive.Provider>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
