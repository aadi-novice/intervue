"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogContent, Icon, TextField, useSnackbar } from "@/components/m3";
import type { EraseReceipt } from "@/lib/api-compliance";
import { complianceErrorMessage, ERASE_ITEMS, eraseConfirmationMatches } from "@/lib/compliance-logic";
import { useEraseCandidate } from "@/lib/queries/compliance";

export function EraseConfirmDialog({
  open,
  onOpenChange,
  candidateName,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateName: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  const [text, setText] = React.useState("");
  const ok = eraseConfirmationMatches(text, candidateName);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) setText("");
        onOpenChange(o);
      }}
    >
      <DialogContent
        icon="warning"
        title={`Erase all data for ${candidateName}?`}
        description="This permanently deletes the following. It cannot be undone."
        actions={
          <>
            <Button variant="text" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon="delete_forever" disabled={!ok} loading={pending} onClick={onConfirm}>
              Erase all data
            </Button>
          </>
        }
      >
        <ul className="mb-4 space-y-1 body-m">
          {ERASE_ITEMS.map((i) => (
            <li key={i} className="flex items-center gap-2">
              <Icon name="remove" size={16} className="text-error" />
              {i}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 body-m text-on-error-container">
            {error}
          </p>
        )}
        <TextField
          label={`Type "${candidateName}" or ERASE to confirm`}
          variant="outlined"
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EraseReceiptDialog({
  receipt,
  candidateName,
  onClose,
}: {
  receipt: EraseReceipt | null;
  candidateName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={receipt != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        icon="check_circle"
        title="Data erased"
        description={`${candidateName} and their data have been permanently deleted.`}
        actions={<Button onClick={onClose}>Back to talent pool</Button>}
      >
        {receipt && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-surface-container p-3 body-m">
            <dt className="text-on-surface-variant">Interviews</dt>
            <dd className="tabular-nums">{receipt.interviews}</dd>
            <dt className="text-on-surface-variant">Recordings</dt>
            <dd className="tabular-nums">{receipt.recordings}</dd>
            <dt className="text-on-surface-variant">Analyses</dt>
            <dd className="tabular-nums">{receipt.analyses}</dd>
            <dt className="text-on-surface-variant">Files deleted</dt>
            <dd className="tabular-nums">{receipt.files_deleted}</dd>
            <dt className="text-on-surface-variant">Erased at</dt>
            <dd>{new Date(receipt.erased_at).toLocaleString()}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Danger-zone button + confirm dialog + receipt dialog. Navigates to the talent pool when finished. */
export function EraseCandidateAction({ candidateId, candidateName }: { candidateId: number | string; candidateName: string }) {
  const router = useRouter();
  const snackbar = useSnackbar();
  const erase = useEraseCandidate();
  const [open, setOpen] = React.useState(false);
  const [receipt, setReceipt] = React.useState<EraseReceipt | null>(null);

  const done = () => {
    setReceipt(null);
    router.push("/dashboard/candidates");
  };

  return (
    <>
      <Button variant="outlined" size="sm" icon="delete_forever" className="text-error" onClick={() => setOpen(true)}>
        Erase all data
      </Button>
      <EraseConfirmDialog
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) erase.reset();
        }}
        candidateName={candidateName}
        pending={erase.isPending}
        error={erase.isError ? complianceErrorMessage(erase.error) : null}
        onConfirm={() =>
          erase.mutate(candidateId, {
            onSuccess: (r) => {
              setOpen(false);
              setReceipt(r);
              snackbar.show("Candidate data erased");
            },
          })
        }
      />
      <EraseReceiptDialog receipt={receipt} candidateName={candidateName} onClose={done} />
    </>
  );
}
