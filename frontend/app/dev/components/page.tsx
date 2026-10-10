import { notFound } from "next/navigation";
import { Showcase } from "./showcase";

export const metadata = { title: "Components | Intervue (dev)" };

export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-dvh">
      <div className="grid gap-0 expanded:grid-cols-2">
        <div className="light bg-surface p-4 text-on-surface medium:p-6">
          <h1 className="mb-6 headline-m">Light theme</h1>
          <Showcase />
        </div>
        <div className="dark bg-surface p-4 text-on-surface medium:p-6">
          <h1 className="mb-6 headline-m">Dark theme</h1>
          <Showcase />
        </div>
      </div>
    </div>
  );
}
