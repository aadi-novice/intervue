"use client";

import * as React from "react";
import { Button, Card, Dialog, DialogContent, EmptyState, Icon, TextField, useSnackbar } from "@/components/m3";
import type { ApiKey } from "@/lib/api-integrations";
import {
  apiKeyErrorMessage,
  formatWhen,
  keyPrefixLabel,
  keyState,
  MAX_KEY_DAYS,
  parseExpiryDays,
  type Reveal,
} from "@/lib/integrations-logic";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/lib/queries/integrations";
import { ConfirmDialog, RevealDialog, SectionError, SectionHeader, SectionSkeleton, StatusPill } from "./shared";

export function ApiKeyList({
  keys,
  loading,
  error,
  onRetry,
  onRevoke,
}: {
  keys: ApiKey[] | undefined;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  onRevoke: (k: ApiKey) => void;
}) {
  if (loading) return <SectionSkeleton label="Loading API keys" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!keys || keys.length === 0)
    return (
      <Card variant="outlined">
        <EmptyState icon="key" title="No API keys">
          Create a key to read roles, rankings, candidates and analyses from your own tools.
        </EmptyState>
      </Card>
    );
  return (
    <ul className="space-y-3">
      {keys.map((k) => {
        const state = keyState(k);
        return (
          <li key={k.id}>
            <Card variant="outlined" className="space-y-2 p-4" data-testid="api-key-card">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words title-m text-on-surface">{k.name}</p>
                  <code className="font-mono text-sm text-on-surface-variant">{keyPrefixLabel(k.prefix)}</code>
                </div>
                {state === "revoked" ? (
                  <StatusPill tone="error">Revoked</StatusPill>
                ) : state === "expired" ? (
                  <StatusPill tone="warning">Expired</StatusPill>
                ) : (
                  <StatusPill tone="success">Active</StatusPill>
                )}
                {state === "active" && (
                  <Button variant="text" size="sm" icon="block" className="text-error" onClick={() => onRevoke(k)}>
                    Revoke
                  </Button>
                )}
              </div>
              <dl className="grid gap-x-6 gap-y-1 body-s text-on-surface-variant medium:grid-cols-4">
                <div>
                  <dt className="label-s">Created</dt>
                  <dd className="text-on-surface">{formatWhen(k.created_at)}</dd>
                </div>
                <div>
                  <dt className="label-s">Last used</dt>
                  <dd className="text-on-surface">{formatWhen(k.last_used_at)}</dd>
                </div>
                <div>
                  <dt className="label-s">Expires</dt>
                  <dd className="text-on-surface">{k.expires_at ? formatWhen(k.expires_at) : "never"}</dd>
                </div>
                {k.revoked_at && (
                  <div>
                    <dt className="label-s">Revoked</dt>
                    <dd className="text-on-surface">{formatWhen(k.revoked_at)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function CreateKeyForm({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (v: { name: string; expires_in_days?: number }) => void;
}) {
  const [name, setName] = React.useState("");
  const [days, setDays] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const expiry = parseExpiryDays(days);
  const nameError = touched && !name.trim() ? "Give the key a name so you can recognise it later." : undefined;
  const daysError = expiry.ok ? undefined : expiry.error;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || !expiry.ok) return;
    onSubmit({ name: name.trim(), ...(expiry.days != null ? { expires_in_days: expiry.days } : {}) });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} error={nameError} placeholder="Reporting dashboard" />
      <TextField
        label="Expires in (days, optional)"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        inputMode="numeric"
        error={daysError}
        supportingText={!daysError ? `Leave empty for no expiry. Maximum ${MAX_KEY_DAYS} days.` : undefined}
      />
      {error && (
        <p role="alert" className="body-s text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="text" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Create key
        </Button>
      </div>
    </form>
  );
}

export function ApiKeysSection() {
  const snackbar = useSnackbar();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [reveal, setReveal] = React.useState<Reveal | null>(null);
  const [toRevoke, setToRevoke] = React.useState<ApiKey | null>(null);

  return (
    <section aria-labelledby="int-keys" className="space-y-4">
      <SectionHeader
        id="int-keys"
        title="API keys"
        description={
          <>
            Keys give read-only access to the public API for this organization and respect blind review (names and emails stay masked and a
            key can never reveal a candidate). See the &ldquo;Public API&rdquo; section of docs/INTEGRATIONS.md for the endpoints.
          </>
        }
        action={
          <Button
            icon="add"
            onClick={() => {
              setCreateError(null);
              setCreating(true);
            }}
          >
            Create key
          </Button>
        }
      />

      <div aria-live="polite">
        <ApiKeyList
          keys={keys.data}
          loading={keys.isLoading}
          error={keys.isError ? apiKeyErrorMessage(keys.error) : null}
          onRetry={() => keys.refetch()}
          onRevoke={setToRevoke}
        />
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <DialogContent icon="key" title="Create API key" description="The full key is shown once, right after you create it." fullScreenOnMobile>
            <CreateKeyForm
              busy={create.isPending}
              error={createError}
              onCancel={() => setCreating(false)}
              onSubmit={(v) => {
                setCreateError(null);
                create.mutate(v, {
                  onSuccess: (d) => {
                    setCreating(false);
                    setReveal({ kind: "apikey", id: d.id, name: d.name, key: d.key });
                  },
                  onError: (e) => setCreateError(apiKeyErrorMessage(e)),
                });
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <RevealDialog reveal={reveal} onClose={() => setReveal(null)} />

      <ConfirmDialog
        open={toRevoke != null}
        onOpenChange={(o) => !o && setToRevoke(null)}
        icon="block"
        title={toRevoke ? `Revoke "${toRevoke.name}"?` : "Revoke key?"}
        description="Applications using this key stop working immediately. This can't be undone."
        confirmLabel="Revoke key"
        busy={revoke.isPending}
        onConfirm={() => {
          if (!toRevoke) return;
          revoke.mutate(toRevoke.id, {
            onSuccess: () => {
              setToRevoke(null);
              snackbar.show("API key revoked");
            },
            onError: (e) => {
              setToRevoke(null);
              snackbar.show(apiKeyErrorMessage(e));
            },
          });
        }}
      />
      <p className="flex items-center gap-2 body-s text-on-surface-variant">
        <Icon name="info" size={16} /> Keys are read-only and also stop working if the admin who created them leaves the organization.
      </p>
    </section>
  );
}
