"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SEED } from "@/app/theme";
import { Button, Card, Select, Switch, TextField, useSnackbar } from "@/components/m3";
import { FormError } from "@/components/auth/auth-ui";
import { currentOrg, useAuthStore, type OrgSummary } from "@/lib/auth-store";
import { applyOrgTheme } from "@/lib/org-theme";
import { CAN, roleAllowed } from "@/lib/roles";
import { errorMessage, useUpdateOrgSettings } from "@/lib/queries/auth";

const AUTO_JOIN = [
  { value: "all", label: "All interviews with a meeting link" },
  { value: "tagged", label: "Only interviews tagged for the notetaker" },
  { value: "never", label: "Never (send manually)" },
];

const DEFAULT_CONSENT =
  "This meeting is being recorded and transcribed by an AI notetaker for hiring purposes.";

function OrgSettingsForm({ org }: { org: OrgSummary }) {
  const s = org.settings;
  const canEdit = roleAllowed(org.role, CAN.admin);
  const snackbar = useSnackbar();
  const update = useUpdateOrgSettings(org.id);

  const [name, setName] = useState(org.name);
  const [seed, setSeed] = useState(s.seed_color ?? DEFAULT_SEED);
  const [blind, setBlind] = useState(!!s.blind_review);
  const [retention, setRetention] = useState(String(s.data_retention_days ?? 365));
  const [botName, setBotName] = useState(s.bot_name ?? "Intervue Notetaker");
  const [consent, setConsent] = useState(s.consent_message ?? DEFAULT_CONSENT);
  const [autoJoin, setAutoJoin] = useState<string>(s.auto_join ?? "tagged");

  // Live theme preview; on leaving (or after save) fall back to the persisted seed.
  useEffect(() => {
    applyOrgTheme(seed);
  }, [seed]);
  useEffect(
    () => () => applyOrgTheme(currentOrg(useAuthStore.getState())?.settings?.seed_color),
    [],
  );

  const retentionNum = Number(retention);
  const retentionError =
    Number.isInteger(retentionNum) && retentionNum >= 1 && retentionNum <= 3650 ? undefined : "Enter 1 to 3650 days";
  const consentError = consent.trim().length >= 10 && consent.length <= 1000 ? undefined : "Must be 10 to 1000 characters";
  const nameError = name.trim() ? undefined : "Name is required";
  const invalid = !!(retentionError || consentError || nameError);

  return (
    <form
      noValidate
      className="max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !canEdit) return;
        update.mutate(
          {
            name: name.trim(),
            seed_color: seed,
            blind_review: blind,
            data_retention_days: retentionNum,
            bot_name: botName.trim() || undefined,
            consent_message: consent.trim(),
            auto_join: autoJoin as "all" | "tagged" | "never",
          },
          { onSuccess: () => snackbar.show("Organization settings saved") },
        );
      }}
    >
      {!canEdit && (
        <p className="body-m text-on-surface-variant">Only organization admins can change these settings.</p>
      )}
      <FormError message={update.isError ? errorMessage(update.error) : null} />

      <Card variant="outlined" className="space-y-5 p-5">
        <h2 className="title-m">Organization</h2>
        <TextField
          label="Organization name"
          variant="outlined"
          value={name}
          error={nameError}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="flex items-center gap-4">
          <input
            id="seed-color"
            type="color"
            value={seed}
            disabled={!canEdit}
            onChange={(e) => setSeed(e.target.value)}
            className="focus-ring size-12 cursor-pointer rounded-full border border-outline bg-transparent p-1 disabled:opacity-38"
          />
          <div className="min-w-0 flex-1">
            <label htmlFor="seed-color" className="label-l text-on-surface">
              Brand color
            </label>
            <p className="body-s text-on-surface-variant">
              Generates your light and dark palettes. Previewed live; save to apply for everyone.
            </p>
          </div>
          {canEdit && s.seed_color !== seed && (
            <Button type="button" variant="text" size="sm" onClick={() => setSeed(DEFAULT_SEED)}>
              Reset
            </Button>
          )}
        </div>

        <Switch
          label="Blind review (hide candidate names and photos while scoring)"
          checked={blind}
          disabled={!canEdit}
          onCheckedChange={setBlind}
        />

        <TextField
          label="Data retention (days)"
          variant="outlined"
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          value={retention}
          error={retentionError}
          supportingText="Recordings and transcripts older than this are deleted."
          disabled={!canEdit}
          onChange={(e) => setRetention(e.target.value)}
        />
      </Card>

      <Card variant="outlined" className="space-y-5 p-5">
        <h2 className="title-m">Notetaker</h2>
        <TextField
          label="Bot display name"
          variant="outlined"
          maxLength={80}
          value={botName}
          supportingText="Shown to participants when the bot joins the meeting."
          disabled={!canEdit}
          onChange={(e) => setBotName(e.target.value)}
        />
        <TextField
          label="Consent message"
          variant="outlined"
          multiline
          rows={4}
          maxLength={1000}
          value={consent}
          error={consentError}
          supportingText="The consent message is always sent when the bot joins; it can be re-worded but not turned off."
          disabled={!canEdit}
          onChange={(e) => setConsent(e.target.value)}
        />
        <Select
          label="Auto-join"
          options={AUTO_JOIN}
          value={autoJoin}
          onValueChange={setAutoJoin}
          disabled={!canEdit}
          supportingText="Which scheduled interviews the notetaker joins automatically."
        />
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending} disabled={invalid}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

export function OrgSettings() {
  const org = useAuthStore((st) => currentOrg(st));
  if (!org) return null;
  return <OrgSettingsForm key={org.id} org={org} />;
}
