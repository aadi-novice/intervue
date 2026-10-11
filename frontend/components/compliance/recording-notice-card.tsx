"use client";

import { Button, Card, Icon } from "@/components/m3";

/** Mirrors backend `settings.bot_default_consent` closely enough for display; the backend sends the real text. */
export const DEFAULT_CONSENT =
  "This meeting is being recorded and transcribed by an AI notetaker for hiring purposes.";

export function effectiveConsentMessage(custom: string | undefined | null): string {
  const t = custom?.trim();
  return t && t.length >= 10 ? t : DEFAULT_CONSENT;
}

export function RecordingNoticeCard({
  message,
  canEdit,
  onEdit,
}: {
  message: string | undefined;
  canEdit: boolean;
  onEdit?: () => void;
}) {
  return (
    <Card variant="outlined" className="space-y-4 p-5">
      <div>
        <h2 className="title-m">Recording notice</h2>
        <p className="body-m text-on-surface-variant">
          The notice is always posted in the meeting chat when the notetaker joins, and it is included in emails to
          candidates. It can be reworded but never turned off.
        </p>
      </div>
      <blockquote className="flex items-start gap-3 rounded-md bg-surface-container p-3 body-m">
        <Icon name="chat" size={20} className="mt-0.5 shrink-0 text-on-surface-variant" />
        <span>{effectiveConsentMessage(message)}</span>
      </blockquote>
      {canEdit && onEdit && (
        <Button variant="tonal" icon="edit" onClick={onEdit}>
          Edit wording in Organization settings
        </Button>
      )}
    </Card>
  );
}
