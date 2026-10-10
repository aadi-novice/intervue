"use client";

import { Button } from "@/components/m3";
import type { ProviderInfo } from "@/lib/api-calendar";
import { PROVIDER_LABEL } from "./calendar-logic";

export function ProviderButtons({
  providers,
  onConnect,
  connecting,
}: {
  providers: ProviderInfo[];
  onConnect: (provider: string) => void;
  connecting: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {providers.map((p) => {
        const hintId = `provider-hint-${p.provider}`;
        return (
          <div key={p.provider} className="flex flex-col gap-1">
            <Button
              variant="tonal"
              icon="add"
              disabled={!p.configured}
              loading={connecting === p.provider}
              aria-describedby={p.configured ? undefined : hintId}
              onClick={() => onConnect(p.provider)}
            >
              Connect {PROVIDER_LABEL[p.provider] ?? p.provider}
            </Button>
            {!p.configured && (
              <p id={hintId} className="max-w-56 body-s text-on-surface-variant">
                Not set up on this server. Ask an admin.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
