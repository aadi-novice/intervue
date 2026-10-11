"use client";

import * as React from "react";
import { Icon } from "@/components/m3";

/** True when the interview's recording/transcript were removed by the retention policy. */
export const TranscriptPurgedContext = React.createContext(false);

export const useTranscriptPurged = () => React.useContext(TranscriptPurgedContext);

export const PURGED_MESSAGE =
  "The recording and transcript were deleted under your retention policy. Notes and analysis are kept; citations that point to the transcript are no longer available.";

export function PurgedBanner() {
  return (
    <div
      role="status"
      data-testid="purged-banner"
      className="flex items-start gap-3 rounded-md bg-secondary-container p-3 body-m text-on-secondary-container"
    >
      <Icon name="info" size={20} filled className="mt-0.5 shrink-0" />
      <p>{PURGED_MESSAGE}</p>
    </div>
  );
}
