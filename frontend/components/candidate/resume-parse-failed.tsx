"use client";

import { Card, Icon } from "@/components/m3";
import { PARSE_FAILED_HINT } from "@/lib/resume-parse";

/** Error banner shown when the resume could not be parsed. The resume download link stays available elsewhere. */
export function ResumeParseFailedBanner({ error }: { error?: string | null }) {
  return (
    <Card variant="outlined" role="alert" className="flex items-start gap-3 border-error p-4">
      <Icon name="error" className="mt-0.5 text-error" />
      <div className="min-w-0">
        <p className="label-l text-error">We couldn&apos;t read this resume</p>
        {error && <p className="mt-1 break-words body-s text-on-surface">{error}</p>}
        <p className="mt-1 body-s text-on-surface-variant">{PARSE_FAILED_HINT}</p>
      </div>
    </Card>
  );
}
