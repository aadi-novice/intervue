"use client";

import { Card, Icon, PageHeader, StaggerItem, type IconName } from "@/components/m3";
import { SegmentedButton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/m3";
import { OrgSettings } from "@/components/settings/org-settings";
import { MembersSettings } from "@/components/settings/members";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PrivacySettings } from "@/components/settings/privacy-settings";
import { IntegrationsAdmin } from "@/components/integrations/integrations-admin";
import { CalendarIntegrations } from "@/components/settings/calendar-integrations";
import { useTheme, type ThemePreference } from "@/components/theme-provider";

const SETTINGS_SECTIONS: { icon: IconName; title: string; description: string; tone: string }[] = [
  { icon: "notifications", title: "Notifications", description: "Configure alerts for stage changes, new applicants, and AI insights", tone: "bg-match-medium-container text-on-match-medium-container" },
  { icon: "shield", title: "Security", description: "Manage authentication, API keys, and access control", tone: "bg-primary-container text-on-primary-container" },
  { icon: "palette", title: "Appearance", description: "Theme, density, and display preferences", tone: "bg-ai-container text-on-ai-container" },
  { icon: "database", title: "Data & Privacy", description: "Export data, retention policies, and GDPR options", tone: "bg-match-strong-container text-on-match-strong-container" },
  { icon: "bolt", title: "Integrations", description: "Connect with ATS, Slack, Google Calendar, and more", tone: "bg-tertiary-container text-on-tertiary-container" },
];

const TABS = ["general", "organization", "members", "integrations", "privacy"];

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  // The URL is the source of truth so `/settings?tab=privacy` links (notifications) work, also while mounted.
  const tab = requested && TABS.includes(requested) ? requested : "general";
  const setTab = (next: string) => {
    router.replace(next === "general" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };
  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader title="Settings" subtitle="Configure your workspace preferences" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-3xl">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="privacy">Data &amp; privacy</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="space-y-6 pt-6">
          <Card variant="outlined" className="max-w-3xl p-5">
            <h2 className="title-m">Theme</h2>
            <p className="mb-3 body-m text-on-surface-variant">Choose light, dark, or follow your system.</p>
            <SegmentedButton<ThemePreference>
              aria-label="Theme"
              value={theme}
              onValueChange={setTheme}
              options={[
                { value: "light", label: "Light", icon: "light_mode" },
                { value: "dark", label: "Dark", icon: "dark_mode" },
                { value: "system", label: "System", icon: "contrast" },
              ]}
            />
          </Card>

          <div className="grid max-w-3xl gap-4 medium:grid-cols-2">
            {SETTINGS_SECTIONS.map((s, i) => (
              <StaggerItem key={s.title} index={i}>
                <Card variant="filled" className="p-5">
                  <div className="flex items-start gap-4">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${s.tone}`}>
                      <Icon name={s.icon} />
                    </span>
                    <div>
                      <p className="title-m text-on-surface">{s.title}</p>
                      <p className="mt-0.5 body-s text-on-surface-variant">{s.description}</p>
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </div>

          <p className="body-s text-on-surface-variant">More settings panels coming soon.</p>
        </TabsContent>
        <TabsContent value="organization" className="pt-6">
          <OrgSettings />
        </TabsContent>
        <TabsContent value="members" className="pt-6">
          <MembersSettings />
        </TabsContent>
        <TabsContent value="integrations" className="pt-6">
          <CalendarIntegrations />
          <IntegrationsAdmin />
        </TabsContent>
        <TabsContent value="privacy" className="pt-6">
          <PrivacySettings onEditNotice={() => setTab("organization")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
