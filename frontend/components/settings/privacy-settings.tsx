"use client";

import { RecordingNoticeCard } from "@/components/compliance/recording-notice-card";
import { ExportCard } from "@/components/compliance/export-card";
import { RetentionCard } from "@/components/compliance/retention-card";
import { currentOrg, useAuthStore } from "@/lib/auth-store";
import { CAN, roleAllowed } from "@/lib/roles";

export function PrivacySettings({ onEditNotice }: { onEditNotice?: () => void }) {
  const org = useAuthStore((s) => currentOrg(s));
  if (!org) return null;
  const isAdmin = roleAllowed(org.role, CAN.admin);
  return (
    <div className="max-w-3xl space-y-6">
      {!isAdmin && (
        <p className="body-m text-on-surface-variant">
          This is how your organization handles interview data. Only admins can change it or export data.
        </p>
      )}
      <RetentionCard key={`${org.id}-${org.settings.data_retention_days}`} orgId={org.id} days={org.settings.data_retention_days} canEdit={isAdmin} />
      <RecordingNoticeCard message={org.settings.consent_message} canEdit={isAdmin} onEdit={onEditNotice} />
      {isAdmin ? (
        <ExportCard orgId={org.id} canRequest />
      ) : (
        <p className="body-s text-on-surface-variant">
          Data export is available to organization admins.
        </p>
      )}
    </div>
  );
}
