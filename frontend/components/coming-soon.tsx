import { EmptyState, PageHeader, type IconName } from "@/components/m3";

export function ComingSoon({ title, icon }: { title: string; icon: IconName }) {
  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader title={title} />
      <EmptyState icon={icon} title="Coming soon">
        This section is under construction.
      </EmptyState>
    </div>
  );
}
