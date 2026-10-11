"use client";

import * as React from "react";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  EmptyState,
  Icon,
  IconButton,
  SideSheetContent,
  Sheet,
  Skeleton,
  Switch,
  TextField,
  LoadingRegion,
  useSnackbar,
} from "@/components/m3";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/api-integrations";
import {
  DELIVERY_POLL_MS,
  deliveryTone,
  disabledReasonLabel,
  displayUrl,
  eventsLabel,
  eventsPayload,
  eventsSelection,
  formatWhen,
  webhookErrorMessage,
  webhookUrlError,
  webhookUrlShapeError,
  type Reveal,
} from "@/lib/integrations-logic";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useDeliveries,
  useRotateSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookEvents,
  useWebhooks,
} from "@/lib/queries/integrations";
import { ConfirmDialog, EventChip, RevealDialog, SectionError, SectionHeader, SectionSkeleton, StatusPill } from "./shared";

// ── Presentational pieces ────────────────────────────────────────────────────

export function WebhookCard({
  endpoint: e,
  busy,
  onToggle,
  onEdit,
  onTest,
  onHistory,
  onRotate,
  onDelete,
}: {
  endpoint: WebhookEndpoint;
  busy?: boolean;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onTest: () => void;
  onHistory: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const { host, path } = displayUrl(e.url);
  return (
    <Card variant="outlined" className="space-y-3 p-4" data-testid="webhook-card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-all title-m text-on-surface">
            {host}
            <span className="text-on-surface-variant">{path}</span>
          </p>
          {e.description && <p className="body-s text-on-surface-variant">{e.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {e.active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="error">Disabled</StatusPill>}
          <Switch
            aria-label={e.active ? `Disable endpoint ${host}` : `Enable endpoint ${host}`}
            checked={e.active}
            disabled={busy}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      <ul aria-label="Subscribed events" className="flex flex-wrap gap-1.5">
        {eventsLabel(e.events).map((ev) => (
          <li key={ev}>
            <EventChip label={ev} />
          </li>
        ))}
      </ul>

      {!e.active && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-error-container p-3 body-s text-on-error-container">
          <Icon name="error" size={18} />
          <span>
            {disabledReasonLabel(e.disabled_reason)}. Fix the receiver, then switch the endpoint back on (this resets the failure count).
          </span>
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-1 body-s text-on-surface-variant medium:grid-cols-3">
        <div>
          <dt className="label-s">Consecutive failures</dt>
          <dd className="text-on-surface">{e.consecutive_failures}</dd>
        </div>
        <div>
          <dt className="label-s">Last success</dt>
          <dd className="text-on-surface">{formatWhen(e.last_success_at)}</dd>
        </div>
        <div>
          <dt className="label-s">Last failure</dt>
          <dd className="text-on-surface">{formatWhen(e.last_failure_at)}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-1">
        <Button variant="tonal" size="sm" icon="send" onClick={onTest}>
          Send test
        </Button>
        <Button variant="text" size="sm" icon="history" onClick={onHistory}>
          Delivery history
        </Button>
        <Button variant="text" size="sm" icon="edit" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="text" size="sm" icon="autorenew" onClick={onRotate}>
          Rotate secret
        </Button>
        <Button variant="text" size="sm" icon="delete" className="text-error" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

/** List with loading, error and empty states. */
export function WebhookList({
  endpoints,
  loading,
  error,
  onRetry,
  renderCard,
}: {
  endpoints: WebhookEndpoint[] | undefined;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  renderCard: (e: WebhookEndpoint) => React.ReactNode;
}) {
  if (loading) return <SectionSkeleton label="Loading webhook endpoints" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!endpoints || endpoints.length === 0)
    return (
      <Card variant="outlined">
        <EmptyState icon="webhook" title="No webhook endpoints">
          Add an endpoint to get a signed HTTPS POST when interviews, analyses or rankings finish.
        </EmptyState>
      </Card>
    );
  return <ul className="space-y-3">{endpoints.map((e) => <li key={e.id}>{renderCard(e)}</li>)}</ul>;
}

const STATUS_PILL: Record<"pending" | "success" | "failed", { tone: "warning" | "success" | "error"; label: string }> = {
  pending: { tone: "warning", label: "Pending" },
  success: { tone: "success", label: "Success" },
  failed: { tone: "error", label: "Failed" },
};

export function DeliveryList({ deliveries, loading }: { deliveries: WebhookDelivery[] | undefined; loading: boolean }) {
  if (loading)
    return (
      <LoadingRegion label="Loading deliveries" className="space-y-3">
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
      </LoadingRegion>
    );
  if (!deliveries || deliveries.length === 0)
    return (
      <EmptyState icon="history" title="No deliveries yet">
        Deliveries appear here after an event is sent or you press Send test.
      </EmptyState>
    );
  return (
    <ul className="space-y-2" aria-live="polite">
      {deliveries.map((d) => {
        const pill = STATUS_PILL[deliveryTone(d.status)];
        return (
          <li key={d.id} className="space-y-1 rounded-md border border-outline-variant p-3" data-testid="delivery">
            <div className="flex items-center justify-between gap-2">
              <span className="break-all label-l text-on-surface">{d.event}</span>
              <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            </div>
            <p className="body-s text-on-surface-variant">
              {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}
              {d.response_code != null && <> · response {d.response_code}</>}
            </p>
            {d.error && <p className="break-words body-s text-error">{d.error}</p>}
            <p className="label-s text-on-surface-variant">
              Created {formatWhen(d.created_at)}
              {d.delivered_at && <> · delivered {formatWhen(d.delivered_at)}</>}
              {!d.delivered_at && d.next_attempt_at && deliveryTone(d.status) === "pending" && <> · next attempt {formatWhen(d.next_attempt_at)}</>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// ── Add / edit dialog ────────────────────────────────────────────────────────

export interface WebhookFormValues {
  url?: string;
  events?: string[];
  description?: string;
}

function WebhookForm({
  endpoint,
  catalogue,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  endpoint: WebhookEndpoint | null;
  catalogue: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (v: { url: string; events: string[]; description: string }) => void;
}) {
  const initial = endpoint ? eventsSelection(endpoint.events) : { all: true, selected: [] as string[] };
  const [url, setUrl] = React.useState(endpoint?.url ?? "");
  const [description, setDescription] = React.useState(endpoint?.description ?? "");
  const [all, setAll] = React.useState(initial.all);
  const [selected, setSelected] = React.useState<string[]>(initial.selected);
  const [touched, setTouched] = React.useState(false);

  const urlError = touched ? webhookUrlShapeError(url) : null;
  const advisory = !urlError && url.trim() ? webhookUrlError(url) : null;
  const payload = eventsPayload(all, selected, catalogue);

  const toggle = (ev: string, on: boolean) => setSelected((s) => (on ? [...s, ev] : s.filter((x) => x !== ev)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (webhookUrlShapeError(url) || !payload) return;
    onSubmit({ url: url.trim(), events: payload, description: description.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField
        label="Endpoint URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder="https://example.com/hooks/intervue"
        inputMode="url"
        autoComplete="off"
        leadingIcon="link"
        maxLength={2000}
        error={urlError ?? undefined}
        supportingText={!urlError ? (advisory ?? "Must be a public https URL. Private and localhost addresses are blocked.") : undefined}
      />
      <TextField
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={200}
      />
      <fieldset className="space-y-1">
        <legend className="label-l text-on-surface-variant">Events</legend>
        <Checkbox label="All events" checked={all} onCheckedChange={(c) => setAll(c === true)} />
        <div className="ps-4">
          {catalogue.map((ev) => (
            <Checkbox
              key={ev}
              label={ev}
              disabled={all}
              checked={all || selected.includes(ev)}
              onCheckedChange={(c) => toggle(ev, c === true)}
            />
          ))}
        </div>
        {touched && !payload && (
          <p role="alert" className="body-s text-error">
            Choose at least one event, or select All events.
          </p>
        )}
      </fieldset>
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
          {endpoint ? "Save changes" : "Add endpoint"}
        </Button>
      </div>
    </form>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function WebhooksSection() {
  const snackbar = useSnackbar();
  const webhooks = useWebhooks();
  const events = useWebhookEvents();
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const rotate = useRotateSecret();
  const del = useDeleteWebhook();
  const test = useTestWebhook();

  const [form, setForm] = React.useState<{ endpoint: WebhookEndpoint | null } | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [reveal, setReveal] = React.useState<Reveal | null>(null);
  const [toRotate, setToRotate] = React.useState<WebhookEndpoint | null>(null);
  const [toDelete, setToDelete] = React.useState<WebhookEndpoint | null>(null);
  const [historyId, setHistoryId] = React.useState<number | null>(null);
  const [polling, setPolling] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<number | null>(null);
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => void (pollTimer.current && clearTimeout(pollTimer.current)), []);

  const list = webhooks.data;
  const history = list?.find((x) => x.id === historyId) ?? null;
  const deliveries = useDeliveries(historyId, polling);

  const openForm = (endpoint: WebhookEndpoint | null) => {
    setFormError(null);
    setForm({ endpoint });
  };

  const submitForm = (v: { url: string; events: string[]; description: string }) => {
    setFormError(null);
    const target = form?.endpoint;
    if (!target) {
      create.mutate(v, {
        onSuccess: (d) => {
          setForm(null);
          setReveal({ kind: "webhook", id: d.id, secret: d.secret, rotated: false });
        },
        onError: (e) => setFormError(webhookErrorMessage(e)),
      });
      return;
    }
    // Send only what changed so an unchanged URL isn't re-validated.
    const data: Parameters<typeof update.mutate>[0]["data"] = {};
    if (v.url !== target.url) data.url = v.url;
    if (JSON.stringify(v.events) !== JSON.stringify(target.events)) data.events = v.events;
    if (v.description !== target.description) data.description = v.description;
    if (Object.keys(data).length === 0) return setForm(null);
    update.mutate(
      { id: target.id, data },
      {
        onSuccess: () => {
          setForm(null);
          snackbar.show("Endpoint updated");
        },
        onError: (e) => setFormError(webhookErrorMessage(e)),
      },
    );
  };

  const onToggle = (e: WebhookEndpoint, active: boolean) => {
    setTogglingId(e.id);
    update.mutate(
      { id: e.id, data: { active } },
      {
        onSuccess: () => snackbar.show(active ? "Endpoint enabled; failure count reset" : "Endpoint disabled"),
        onError: (err) => snackbar.show(webhookErrorMessage(err)),
        onSettled: () => setTogglingId(null),
      },
    );
  };

  const onTest = (e: WebhookEndpoint) => {
    test.mutate(e.id, {
      onSuccess: () => {
        snackbar.show("Test event sent. Checking the delivery result…");
        setHistoryId(e.id);
        setPolling(true);
        if (pollTimer.current) clearTimeout(pollTimer.current);
        pollTimer.current = setTimeout(() => setPolling(false), 12 * DELIVERY_POLL_MS);
      },
      onError: (err) => snackbar.show(webhookErrorMessage(err)),
    });
  };

  const confirmRotate = () => {
    if (!toRotate) return;
    rotate.mutate(toRotate.id, {
      onSuccess: (d) => {
        setToRotate(null);
        setReveal({ kind: "webhook", id: d.id, secret: d.secret, rotated: true });
      },
      onError: (err) => {
        setToRotate(null);
        snackbar.show(webhookErrorMessage(err));
      },
    });
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    del.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        if (historyId === toDelete.id) setHistoryId(null);
        snackbar.show("Endpoint deleted");
      },
      onError: (err) => {
        setToDelete(null);
        snackbar.show(webhookErrorMessage(err));
      },
    });
  };

  const catalogue = events.data ?? [];

  return (
    <section aria-labelledby="int-webhooks" className="space-y-4">
      <SectionHeader
        id="int-webhooks"
        title="Webhooks"
        description="Receive a signed HTTPS POST at your endpoint when an interview, analysis or ranking finishes. Payloads carry ids and scores, never candidate names or transcript text."
        action={
          <Button icon="add" onClick={() => openForm(null)} disabled={events.isLoading}>
            Add endpoint
          </Button>
        }
      />

      <div aria-live="polite">
        <WebhookList
          endpoints={list}
          loading={webhooks.isLoading}
          error={webhooks.isError ? webhookErrorMessage(webhooks.error) : null}
          onRetry={() => webhooks.refetch()}
          renderCard={(e) => (
            <WebhookCard
              endpoint={e}
              busy={togglingId === e.id}
              onToggle={(a) => onToggle(e, a)}
              onEdit={() => openForm(e)}
              onTest={() => onTest(e)}
              onHistory={() => {
                setPolling(false);
                setHistoryId(e.id);
              }}
              onRotate={() => setToRotate(e)}
              onDelete={() => setToDelete(e)}
            />
          )}
        />
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        {form && (
          <DialogContent
            icon="webhook"
            title={form.endpoint ? "Edit endpoint" : "Add webhook endpoint"}
            description={form.endpoint ? undefined : "Intervue will show the signing secret once after you add the endpoint."}
            fullScreenOnMobile
          >
            <WebhookForm
              endpoint={form.endpoint}
              catalogue={catalogue}
              busy={create.isPending || update.isPending}
              error={formError ?? (events.isError ? webhookErrorMessage(events.error) : null)}
              onCancel={() => setForm(null)}
              onSubmit={submitForm}
            />
          </DialogContent>
        )}
      </Dialog>

      <RevealDialog reveal={reveal} onClose={() => setReveal(null)} />

      <ConfirmDialog
        open={toRotate != null}
        onOpenChange={(o) => !o && setToRotate(null)}
        icon="autorenew"
        title="Rotate signing secret?"
        description="The old secret stops working immediately. Update your receiver with the new secret or signature checks will fail."
        confirmLabel="Rotate secret"
        busy={rotate.isPending}
        onConfirm={confirmRotate}
      />
      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => !o && setToDelete(null)}
        icon="delete"
        title="Delete this endpoint?"
        description="Intervue stops sending events to it and its delivery history is removed."
        confirmLabel="Delete endpoint"
        busy={del.isPending}
        onConfirm={confirmDelete}
      />

      <Sheet
        open={historyId != null}
        onOpenChange={(o) => {
          if (!o) {
            setHistoryId(null);
            setPolling(false);
          }
        }}
      >
        {historyId != null && (
          <SideSheetContent title="Delivery history" className="max-w-[480px]">
            {history && <p className="mb-3 break-all body-s text-on-surface-variant">{displayUrl(history.url).host}{displayUrl(history.url).path}</p>}
            {deliveries.isError ? (
              <SectionError message={webhookErrorMessage(deliveries.error)} onRetry={() => deliveries.refetch()} />
            ) : (
              <DeliveryList deliveries={deliveries.data} loading={deliveries.isLoading} />
            )}
            <div className="mt-3 flex justify-end">
              <IconButton icon="refresh" label="Refresh deliveries" onClick={() => deliveries.refetch()} />
            </div>
          </SideSheetContent>
        )}
      </Sheet>
    </section>
  );
}
