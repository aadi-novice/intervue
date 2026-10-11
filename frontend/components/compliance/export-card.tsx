"use client";

import * as React from "react";
import { Button, Card, Icon, LinearProgress, Skeleton, Switch, useSnackbar } from "@/components/m3";
import { complianceApi, type ExportStatus } from "@/lib/api-compliance";
import { complianceErrorMessage, exportUiState, formatBytes } from "@/lib/compliance-logic";
import { useLatestExport, useRequestExport } from "@/lib/queries/compliance";

export interface ExportCardViewProps {
  status: ExportStatus | undefined;
  loading?: boolean;
  loadError?: string | null;
  includeRecordings: boolean;
  onIncludeChange: (v: boolean) => void;
  onRequest: () => void;
  requesting?: boolean;
  onDownload: () => void;
  downloading?: boolean;
  canRequest: boolean;
}

/** Presentational export card; every backend state maps to one block. */
export function ExportCardView({
  status,
  loading,
  loadError,
  includeRecordings,
  onIncludeChange,
  onRequest,
  requesting,
  onDownload,
  downloading,
  canRequest,
}: ExportCardViewProps) {
  const ui = exportUiState(status?.status);

  const requestControls = (label: string) =>
    canRequest ? (
      <div className="space-y-3">
        <Switch
          label="Include recordings (large)"
          checked={includeRecordings}
          disabled={requesting}
          onCheckedChange={onIncludeChange}
        />
        <Button icon="archive" loading={requesting} onClick={onRequest}>
          {label}
        </Button>
      </div>
    ) : (
      <p className="body-s text-on-surface-variant">Only organization admins can request an export.</p>
    );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div role="status" aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading export status</span>
        <Skeleton className="h-5 w-1/2 rounded-sm" />
        <Skeleton className="h-10 w-40 rounded-full" />
      </div>
    );
  } else if (loadError) {
    body = (
      <p role="alert" className="body-m text-error">
        {loadError}
      </p>
    );
  } else if (ui === "working") {
    body = (
      <div className="space-y-3" data-testid="export-working">
        <p className="body-m text-on-surface">
          {status?.status === "running" ? "Building your export…" : "Export queued…"}
          {status?.include_recordings ? " Recordings are included, so this can take a while." : ""}
        </p>
        <LinearProgress aria-label="Export in progress" />
      </div>
    );
  } else if (ui === "completed") {
    body = (
      <div className="space-y-4" data-testid="export-completed">
        <div className="flex items-start gap-3 rounded-md bg-surface-container p-3">
          <Icon name="check_circle" filled className="mt-0.5 text-match-strong" />
          <div className="min-w-0 flex-1 body-m">
            <p className="title-s">Your export is ready</p>
            <p className="text-on-surface-variant">
              {formatBytes(status?.size_bytes)} · {status?.files ?? 0} {status?.files === 1 ? "file" : "files"}
              {status?.include_recordings ? " · includes recordings" : ""}
            </p>
            {status?.expires_at && (
              <p className="text-on-surface-variant">Available until {new Date(status.expires_at).toLocaleString()}</p>
            )}
          </div>
          {canRequest && (
            <Button icon="download" loading={downloading} onClick={onDownload}>
              Download
            </Button>
          )}
        </div>
        {requestControls("Request a new export")}
      </div>
    );
  } else if (ui === "failed") {
    body = (
      <div className="space-y-4" data-testid="export-failed">
        <div role="alert" className="flex items-start gap-2 rounded-md bg-error-container p-3 body-m text-on-error-container">
          <Icon name="error" filled className="mt-0.5 shrink-0" />
          <div>
            <p className="title-s">The export failed</p>
            <p>{status?.error || "Something went wrong while building the export."}</p>
          </div>
        </div>
        {requestControls("Retry export")}
      </div>
    );
  } else if (ui === "expired") {
    body = (
      <div className="space-y-4" data-testid="export-expired">
        <p className="body-m text-on-surface-variant">
          The last export has expired and can no longer be downloaded. Request a new export to get a fresh copy.
        </p>
        {requestControls("Request a new export")}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4" data-testid="export-none">
        <p className="body-m text-on-surface-variant">No export has been requested yet.</p>
        {requestControls("Request export")}
      </div>
    );
  }

  return (
    <Card variant="outlined" className="space-y-4 p-5">
      <div>
        <h2 className="title-m">Export all data</h2>
        <p className="body-m text-on-surface-variant">
          Download a copy of everything in this organization: candidates, roles, interviews, transcripts, notes and
          analyses. You will also get a notification when it is ready.
        </p>
      </div>
      <div aria-live="polite">{body}</div>
      <p className="body-s text-on-surface-variant">
        Not included: password hashes, OAuth tokens, embeddings and cached AI results. Download links are short-lived.
      </p>
    </Card>
  );
}

export function ExportCard({ orgId, canRequest }: { orgId: number; canRequest: boolean }) {
  const snackbar = useSnackbar();
  const latest = useLatestExport(orgId, canRequest);
  const request = useRequestExport(orgId);
  const [include, setInclude] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  const onRequest = () =>
    request.mutate(include, {
      onSuccess: () => snackbar.show("Export requested"),
      onError: (e) => snackbar.show(complianceErrorMessage(e)),
    });

  const onDownload = async () => {
    setDownloading(true);
    try {
      const r = await complianceApi.exportDownload(orgId);
      if (!r.url) {
        snackbar.show("The export is no longer available. Request a new one.");
        void latest.refetch();
        return;
      }
      const w = window.open(r.url, "_blank", "noopener,noreferrer");
      if (!w) window.location.assign(r.url);
    } catch (e) {
      snackbar.show(complianceErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ExportCardView
      status={latest.data}
      loading={canRequest && latest.isLoading}
      loadError={latest.isError ? complianceErrorMessage(latest.error) : null}
      includeRecordings={include}
      onIncludeChange={setInclude}
      onRequest={onRequest}
      requesting={request.isPending}
      onDownload={onDownload}
      downloading={downloading}
      canRequest={canRequest}
    />
  );
}
