"use client";

import * as React from "react";
import { Button, Card, TextField, useSnackbar } from "@/components/m3";
import { FormError } from "@/components/auth/auth-ui";
import { validateRetentionDays } from "@/lib/compliance-logic";
import { errorMessage, useUpdateOrgSettings } from "@/lib/queries/auth";

export const DEFAULT_RETENTION_DAYS = 365;

export function RetentionCard({
  orgId,
  days,
  canEdit,
}: {
  orgId: number;
  days: number | undefined;
  canEdit: boolean;
}) {
  const snackbar = useSnackbar();
  const update = useUpdateOrgSettings(orgId);
  const current = days ?? DEFAULT_RETENTION_DAYS;
  const [value, setValue] = React.useState(String(current));
  const { value: parsed, error } = validateRetentionDays(value);
  const dirty = parsed !== current;

  return (
    <Card variant="outlined" className="space-y-4 p-5">
      <div>
        <h2 className="title-m">Retention</h2>
        <p className="body-m text-on-surface-variant">
          Recordings, transcripts and speaker data are deleted this many days after the interview. Notes and analyses
          are kept but their transcript links stop working. Cached AI results expire after 30 days.
        </p>
      </div>
      {canEdit ? (
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (error || parsed == null) return;
            update.mutate(
              { data_retention_days: parsed },
              { onSuccess: () => snackbar.show("Retention period saved") },
            );
          }}
        >
          <FormError message={update.isError ? errorMessage(update.error) : null} />
          <div className="flex flex-wrap items-start gap-3">
            <TextField
              label="Retention (days)"
              variant="outlined"
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={value}
              error={error ?? undefined}
              supportingText="1 to 3650 days"
              containerClassName="w-56"
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" className="mt-1" loading={update.isPending} disabled={!!error || !dirty}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="body-m">
          <span className="label-l">Current retention:</span> {current} days.{" "}
          <span className="text-on-surface-variant">Only organization admins can change this.</span>
        </p>
      )}
    </Card>
  );
}
