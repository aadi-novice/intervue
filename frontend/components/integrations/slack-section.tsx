"use client";

import * as React from "react";
import { Button, Card, Checkbox, Icon, TextField, useSnackbar } from "@/components/m3";
import type { SlackStatus } from "@/lib/api-integrations";
import { SLACK_EVENTS, SLACK_URL_PREFIX, slackErrorMessage, slackHint, slackUrlError } from "@/lib/integrations-logic";
import { useConfigureSlack, useRemoveSlack, useSlack, useTestSlack } from "@/lib/queries/integrations";
import { ConfirmDialog, SectionError, SectionHeader, SectionSkeleton, StatusPill } from "./shared";

/**
 * Form + status. The saved URL is never displayed (the API only returns its last 4 characters) and the input is
 * cleared after saving.
 */
export function SlackForm({
  status,
  saving,
  testing,
  testResult,
  serverError,
  onSave,
  onTest,
  onRemove,
}: {
  status: SlackStatus;
  saving: boolean;
  testing: boolean;
  testResult: { ok: boolean; error: string | null } | null;
  serverError: string | null;
  onSave: (v: { webhook_url: string; events: string[] }) => Promise<boolean>;
  onTest: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [events, setEvents] = React.useState<string[]>(status.configured ? status.events : [...SLACK_EVENTS]);

  // Keep checkboxes in step with the server after refetches (adjust state during render, not in an effect).
  const eventsKey = `${status.configured}:${status.events.join(",")}`;
  const [syncedKey, setSyncedKey] = React.useState(eventsKey);
  if (syncedKey !== eventsKey) {
    setSyncedKey(eventsKey);
    if (status.configured) setEvents(status.events);
  }

  const urlError = touched ? slackUrlError(url) : null;
  const toggle = (ev: string, on: boolean) => setEvents((s) => (on ? [...s, ev] : s.filter((x) => x !== ev)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (slackUrlError(url) || events.length === 0) return;
    const ok = await onSave({ webhook_url: url.trim(), events: SLACK_EVENTS.filter((x) => events.includes(x)) });
    if (ok) {
      setUrl("");
      setTouched(false);
    }
  };

  return (
    <div className="space-y-4">
      {status.last_error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-error-container p-3 body-m text-on-error-container" data-testid="slack-last-error">
          <Icon name="error" size={20} />
          <span>
            <strong className="label-l">Slack rejected the last message.</strong> {status.last_error}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status.configured ? <StatusPill tone="success">Connected</StatusPill> : <StatusPill tone="neutral">Not connected</StatusPill>}
        {status.configured && <span className="body-s text-on-surface-variant">{slackHint(status.hint)}</span>}
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label={status.configured ? "Replace Incoming Webhook URL" : "Incoming Webhook URL"}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={`${SLACK_URL_PREFIX}services/...`}
          leadingIcon="link"
          maxLength={500}
          error={urlError ?? undefined}
          supportingText={!urlError ? "Treated as a secret: stored encrypted and never shown again after saving." : undefined}
        />
        <fieldset className="space-y-1">
          <legend className="label-l text-on-surface-variant">Post a message when</legend>
          {SLACK_EVENTS.map((ev) => (
            <Checkbox key={ev} label={ev} checked={events.includes(ev)} onCheckedChange={(c) => toggle(ev, c === true)} />
          ))}
          {touched && events.length === 0 && (
            <p role="alert" className="body-s text-error">
              Choose at least one event.
            </p>
          )}
        </fieldset>
        {serverError && (
          <p role="alert" className="body-s text-error">
            {serverError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saving} icon="save">
            {status.configured ? "Save changes" : "Save"}
          </Button>
          {status.configured && (
            <>
              <Button type="button" variant="tonal" icon="send" loading={testing} onClick={onTest}>
                Send test message
              </Button>
              <Button type="button" variant="text" icon="link_off" className="text-error" onClick={onRemove}>
                Remove
              </Button>
            </>
          )}
        </div>
        {status.configured && <p className="body-s text-on-surface-variant">The saved URL is never shown. To change the events or replace the channel, paste the webhook URL again and save.</p>}
      </form>

      <div aria-live="polite">
        {testResult &&
          (testResult.ok ? (
            <p className="flex items-center gap-2 body-m text-match-strong">
              <Icon name="check_circle" size={20} /> Test message sent. Check your Slack channel.
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 body-m text-error">
              <Icon name="error" size={20} /> Test failed: {testResult.error ?? "Slack did not accept the message."}
            </p>
          ))}
      </div>
    </div>
  );
}

export function SlackSection() {
  const snackbar = useSnackbar();
  const slack = useSlack();
  const configure = useConfigureSlack();
  const remove = useRemoveSlack();
  const test = useTestSlack();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error: string | null } | null>(null);
  const [confirm, setConfirm] = React.useState(false);

  const save = (v: { webhook_url: string; events: string[] }) =>
    new Promise<boolean>((resolve) => {
      setServerError(null);
      setTestResult(null);
      configure.mutate(v, {
        onSuccess: () => {
          snackbar.show("Slack settings saved");
          resolve(true);
        },
        onError: (e) => {
          setServerError(slackErrorMessage(e));
          resolve(false);
        },
      });
    });

  return (
    <section aria-labelledby="int-slack" className="space-y-4">
      <SectionHeader
        id="int-slack"
        title="Slack"
        description="Post interview, analysis and ranking updates to a channel. Messages carry ids, scores and role names, never candidate names. Create an Incoming Webhook in Slack for the channel and paste its URL here."
      />
      {slack.isLoading ? (
        <SectionSkeleton label="Loading Slack settings" />
      ) : slack.isError || !slack.data ? (
        <SectionError message={slackErrorMessage(slack.error)} onRetry={() => slack.refetch()} />
      ) : (
        <Card variant="outlined" className="p-4">
          <SlackForm
            status={slack.data}
            saving={configure.isPending}
            testing={test.isPending}
            testResult={testResult}
            serverError={serverError}
            onSave={save}
            onTest={() => {
              setTestResult(null);
              test.mutate(undefined, {
                onSuccess: (r) => setTestResult(r),
                onError: (e) => snackbar.show(slackErrorMessage(e)),
              });
            }}
            onRemove={() => setConfirm(true)}
          />
        </Card>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        icon="link_off"
        title="Remove Slack?"
        description="Intervue stops posting to Slack and forgets the webhook URL. You'll need to paste it again to reconnect."
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              setTestResult(null);
              snackbar.show("Slack removed");
            },
            onError: (e) => {
              setConfirm(false);
              snackbar.show(slackErrorMessage(e));
            },
          })
        }
      />
    </section>
  );
}
