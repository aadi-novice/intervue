import Link from "next/link";
import { Card, Icon } from "@/components/m3";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-on-surface">
      <header className="flex items-center justify-between px-4 py-3 medium:px-6">
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-full px-2 py-1 title-m">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-on-primary">
            <Icon name="record_voice_over" size={20} filled />
          </span>
          Intervue
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-12">
        <Card variant="elevated" className="w-full max-w-[440px] rounded-xl p-6 medium:p-8">
          {children}
        </Card>
      </main>
    </div>
  );
}
