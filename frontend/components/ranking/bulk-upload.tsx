"use client";

import * as React from "react";
import { Button, Icon, LinearProgress } from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { apiMessage, batchFinished, BULK_MAX_FILES, validateResumeFiles } from "@/lib/api-ranking";
import { CAN } from "@/lib/roles";
import { useBatch, useBulkUpload } from "@/lib/queries/ranking";
import { cn } from "@/lib/utils";

const ISSUE_LABEL: Record<string, string> = {
  duplicate: "Duplicate",
  no_email: "No email found",
  error: "Error",
  failed: "Error",
};

/** Always-visible resume drop zone: drag and drop or pick PDF / DOCX / ZIP files (max 500). */
export function BulkUpload({ roleId }: { roleId: number }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [batchId, setBatchId] = React.useState<number | null>(null);
  const [problems, setProblems] = React.useState<{ name: string; reason: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const upload = useBulkUpload(roleId);
  const batch = useBatch(batchId, roleId);
  const b = batch.data;
  const done = batchFinished(b?.status);
  const percent = b && b.total > 0 ? ((b.processed + b.failed) / b.total) * 100 : undefined;

  const submit = (list: FileList | File[]) => {
    const { accepted, rejected } = validateResumeFiles(Array.from(list));
    setProblems(rejected);
    setError(null);
    if (accepted.length === 0) return;
    upload.mutate(accepted, {
      onSuccess: (r) => setBatchId(r.batch_id),
      onError: (e) => setError(apiMessage(e)),
    });
  };

  const status = upload.isPending
    ? "Uploading files…"
    : b
      ? done
        ? `Finished: ${b.processed} processed, ${b.failed} failed of ${b.total}`
        : `Processing resumes: ${b.processed + b.failed} of ${b.total || "…"}`
      : "";

  return (
    <RequireRole
      roles={CAN.create}
      fallback={<p className="body-s text-on-surface-variant">Your role can view rankings but not upload resumes.</p>}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          submit(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/8" : "border-outline-variant bg-surface-container-low",
        )}
      >
        <Icon name="upload_file" size={32} className="text-primary" />
        <p className="title-s text-on-surface">Drop resumes here</p>
        <p className="body-s text-on-surface-variant">PDF, DOCX or a ZIP of them. Up to {BULK_MAX_FILES} files, 10 MB each.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.zip,application/pdf,application/zip"
          className="sr-only"
          aria-label="Choose resume files"
          data-testid="bulk-input"
          onChange={(e) => {
            if (e.target.files) submit(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="tonal" icon="folder_open" onClick={() => inputRef.current?.click()} loading={upload.isPending}>
          Choose files
        </Button>

        <div aria-live="polite" className="w-full max-w-md space-y-2">
          {status && <p className="label-l text-on-surface">{status}</p>}
          {(upload.isPending || (b && !done)) && (
            <LinearProgress value={upload.isPending ? undefined : percent} aria-label="Resume intake progress" />
          )}
          {b && done && <LinearProgress value={100} aria-label="Resume intake progress" indicatorClassName="bg-match-strong" />}
        </div>

        {error && (
          <p role="alert" className="body-m text-error">
            {error}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="w-full max-w-md text-start body-s text-error" aria-label="Rejected files">
            {problems.slice(0, 20).map((p, i) => (
              <li key={i}>
                {p.name}: {p.reason}
              </li>
            ))}
            {problems.length > 20 && <li>…and {problems.length - 20} more</li>}
          </ul>
        )}
        {b && b.errors.length > 0 && (
          <details className="w-full max-w-md text-start">
            <summary className="cursor-pointer label-l text-on-surface-variant">
              {b.errors.length} file issue{b.errors.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 max-h-48 overflow-y-auto body-s text-on-surface-variant">
              {b.errors.map((e, i) => (
                <li key={i}>
                  <span className="label-m text-on-surface">{e.file}</span> — {ISSUE_LABEL[e.status ?? ""] ?? e.status}
                  {e.detail ? `: ${e.detail}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </RequireRole>
  );
}
