"use client";

import * as React from "react";
import { Button, Dialog, DialogContent, Icon, useSnackbar } from "@/components/m3";
import { effectiveConsentMessage } from "@/components/compliance/recording-notice-card";
import { complianceErrorMessage } from "@/lib/compliance-logic";
import { useNotifyCandidate } from "@/lib/queries/compliance";
import { currentOrg, useAuthStore } from "@/lib/auth-store";
import { formatWhen } from "@/components/interviews/interviews-explorer";

export function NotifyCandidateDialog({
  open,
  onOpenChange,
  candidateName,
  when,
  meetingUrl,
  consentMessage,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateName: string;
  when: string;
  meetingUrl: string | null;
  consentMessage: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        icon="mail"
        title={`Email ${candidateName}?`}
        description="The candidate will receive an email with these details."
        actions={
          <>
            <Button variant="text" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button icon="send" loading={pending} onClick={onConfirm}>
              Send email
            </Button>
          </>
        }
      >
        <dl className="space-y-3 body-m">
          <div>
            <dt className="label-l text-on-surface-variant">When</dt>
            <dd>{when}</dd>
          </div>
          <div>
            <dt className="label-l text-on-surface-variant">Meeting link</dt>
            <dd className="break-all">{meetingUrl ?? "None yet. The email says details will follow."}</dd>
          </div>
          {meetingUrl && (
            <div>
              <dt className="label-l text-on-surface-variant">Recording notice included</dt>
              <dd>
                <blockquote className="mt-1 flex items-start gap-2 rounded-md bg-surface-container p-3">
                  <Icon name="chat" size={18} className="mt-0.5 shrink-0 text-on-surface-variant" />
                  <span>{consentMessage}</span>
                </blockquote>
              </dd>
            </div>
          )}
        </dl>
        {error && (
          <p role="alert" className="mt-3 rounded-sm bg-error-container px-3 py-2 body-m text-on-error-container">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NotifyCandidateButton({
  interviewId,
  candidateName,
  scheduledStart,
  meetingUrl,
}: {
  interviewId: number;
  candidateName: string;
  scheduledStart: string | null;
  meetingUrl: string | null;
}) {
  const snackbar = useSnackbar();
  const notify = useNotifyCandidate();
  const consent = useAuthStore((s) => currentOrg(s)?.settings.consent_message);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="outlined"
        icon="mail"
        onClick={() => {
          notify.reset();
          setOpen(true);
        }}
      >
        Email candidate
      </Button>
      <NotifyCandidateDialog
        open={open}
        onOpenChange={setOpen}
        candidateName={candidateName}
        when={scheduledStart ? formatWhen(scheduledStart) : "To be confirmed"}
        meetingUrl={meetingUrl}
        consentMessage={effectiveConsentMessage(consent)}
        pending={notify.isPending}
        error={notify.isError ? complianceErrorMessage(notify.error) : null}
        onConfirm={() =>
          notify.mutate(interviewId, {
            onSuccess: (r) => {
              setOpen(false);
              snackbar.show(`Email sent to ${r.sent_to}`);
            },
          })
        }
      />
    </>
  );
}
