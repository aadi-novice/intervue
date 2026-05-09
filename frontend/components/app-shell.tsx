"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Kanban,
  Users,
  ArrowLeftRight,
  Settings,
  HelpCircle,
  LogOut,
  Sparkles,
  Plus,
  Bell,
  Search,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/dashboard/candidates", label: "Talent Pool", icon: Users },
  { href: "/compare", label: "Matrix", icon: ArrowLeftRight },
];

const bottomNav = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help", icon: HelpCircle },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex overflow-hidden bg-[#10131a]" style={{ height: '100dvh' }}>
      {/* Sidebar */}
      <aside className="flex-shrink-0 flex flex-col border-r border-[#424754] bg-[#191b23] z-20" style={{ width: 200 }}>
        {/* Logo */}
        <div className="px-5 py-6 border-b border-[#424754]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3b82f6] flex items-center justify-center nh-action-glow">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div
                className="text-[15px] font-semibold text-[#e1e2ec]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Neuro-Hiring
              </div>
              <div className="text-[10px] text-[#8c909f] font-mono tracking-widest uppercase">
                AI Recruitment
              </div>
            </div>
          </div>
        </div>

        {/* Main Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/dashboard"
                ? pathname === "/dashboard" || pathname === "/"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "sidebar-item relative",
                  active && "active"
                )}
              >
                {active && <span className="sidebar-indicator" />}
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}

          <div className="pt-4 pb-1">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-[#424754] px-3 mb-2">
              Active Roles
            </p>
            {[
              "Sr. Rust Engineer",
              "Lead Product Designer",
              "Data Scientist, ML",
            ].map((role) => (
              <div
                key={role}
                className={cn(
                  "sidebar-item text-[13px]",
                  "text-[#8c909f] hover:text-[#e1e2ec]"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] flex-shrink-0" />
                {role}
              </div>
            ))}
          </div>
        </nav>

        {/* Bottom Nav */}
        <div className="px-3 pb-4 border-t border-[#424754] pt-3 space-y-1">
          {bottomNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn("sidebar-item", pathname === href && "active")}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
          <button className="sidebar-item w-full text-[#f43f5e] hover:bg-[#2a1520]">
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-12 border-b border-[#424754] bg-[#191b23] flex items-center justify-between px-4 flex-shrink-0 gap-3">
          {/* Search */}
          <div className="flex items-center gap-2 bg-[#272a31] border border-[#424754] rounded-lg px-3 py-1.5 flex-1 max-w-xs focus-within:border-[#3b82f6] transition-colors">
            <Search className="w-3.5 h-3.5 text-[#8c909f] flex-shrink-0" />
            <input
              type="text"
              placeholder="Search candidates, roles..."
              className="bg-transparent text-sm text-[#e1e2ec] placeholder-[#8c909f] outline-none w-full min-w-0"
            />
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Add Candidate */}
            <Link
              href="/candidate/new"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3b82f6] text-white text-xs font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Candidate
            </Link>

            {/* Notification */}
            <button className="w-7 h-7 rounded-lg bg-[#272a31] border border-[#424754] flex items-center justify-center hover:bg-[#32353c] transition-colors relative flex-shrink-0">
              <Bell className="w-3.5 h-3.5 text-[#8c909f]" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
            </button>

            {/* Avatar */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#a78bfa] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
              AK
            </div>
          </div>
        </header>

        {/* Page content */}
        {/* Pipeline uses its own overflow; other pages scroll here */}
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    </div>
  );
}
