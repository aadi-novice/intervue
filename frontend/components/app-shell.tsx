"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CandidateAvatar,
  Fab,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  NavigationBar,
  NavigationDrawer,
  NavigationRail,
  SearchBar,
  TopAppBar,
  useWindowSizeClass,
  type NavDestination,
} from "@/components/m3";
import { useMotionPattern } from "@/app/theme/motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { CAN, roleAllowed, useRole } from "@/lib/roles";

const DESTINATIONS: NavDestination[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { id: "roles", label: "Roles", icon: "work", href: "/roles" },
  { id: "candidates", label: "Candidates", icon: "groups", href: "/dashboard/candidates" },
  { id: "interviews", label: "Interviews", icon: "event", href: "/interviews" },
  { id: "compare", label: "Compare", icon: "compare_arrows", href: "/compare" },
];

const DRAWER_DESTINATIONS: NavDestination[] = [
  ...DESTINATIONS,
  { id: "settings", label: "Settings", icon: "settings", href: "/settings" },
];

function activeIdFor(pathname: string): string {
  if (pathname.startsWith("/roles") || pathname.startsWith("/dashboard/pipeline")) return "roles";
  if (pathname.startsWith("/dashboard/candidates") || pathname.startsWith("/candidate")) return "candidates";
  if (pathname.startsWith("/interviews")) return "interviews";
  if (pathname.startsWith("/compare")) return "compare";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

const renderLink = (p: { href: string; className: string; children: React.ReactNode; "aria-current"?: "page" }) => (
  <Link href={p.href} className={p.className} aria-current={p["aria-current"]}>
    {p.children}
  </Link>
);

function NewMenu({ children, side }: { children: React.ReactNode; side?: "top" | "bottom" | "right" }) {
  const router = useRouter();
  const role = useRole();
  // Recruiters and admins create; other roles get no create entry points.
  if (role !== null && !roleAllowed(role, CAN.create)) return null;
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent side={side} align={side === "right" ? "start" : "end"}>
        <MenuItem leadingIcon="work" onSelect={() => router.push("/roles/new")}>New role</MenuItem>
        <MenuItem leadingIcon="person_add" onSelect={() => router.push("/candidate/new")}>New candidate</MenuItem>
        <MenuItem leadingIcon="event" onSelect={() => router.push("/interviews")}>New interview</MenuItem>
        <MenuItem leadingIcon="cloud_upload" onSelect={() => router.push("/candidate/new")}>Bulk upload</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Default avatar menu slot (auth comes later). */
function DefaultAvatarMenu() {
  const router = useRouter();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="Account menu" className="focus-ring ms-1 rounded-full">
          <CandidateAvatar name="Intervue User" size="sm" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem leadingIcon="settings" onSelect={() => router.push("/settings")}>Settings</MenuItem>
        <MenuSeparator />
        <MenuItem leadingIcon="logout" disabled>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function DefaultOrgSwitcher() {
  return (
    <span className="hidden h-8 items-center gap-2 rounded-sm border border-outline-variant px-3 label-l text-on-surface-variant medium:inline-flex">
      <span className="material-symbol text-[18px]" aria-hidden>domain</span>
      Intervue
    </span>
  );
}

export interface AppShellProps {
  children: React.ReactNode;
  /** Org switcher slot (placeholder until auth/orgs land). */
  orgSwitcher?: React.ReactNode;
  /** Avatar menu slot. */
  avatarMenu?: React.ReactNode;
  /** Full-width banner rendered between the top app bar and the page (e.g. unverified email). */
  banner?: React.ReactNode;
}

export default function AppShell({ children, orgSwitcher, avatarMenu, banner }: AppShellProps) {
  const pathname = usePathname();
  const size = useWindowSizeClass();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const compact = size === "compact";
  const activeId = activeIdFor(pathname);
  const topLevel = activeId; // fade-through keyed by top-level destination
  const fade = useMotionPattern("fadeThrough");

  return (
    <div className="flex h-dvh flex-col bg-surface text-on-surface">
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-primary px-4 py-2 label-l text-on-primary focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-0 flex-1">
        {!compact && (
          <NavigationRail
            destinations={DESTINATIONS}
            activeId={activeId}
            renderLink={renderLink}
            header={
              <NewMenu side="right">
                <Fab icon="add" label="New" color="tertiary" />
              </NewMenu>
            }
            footer={
              <IconButton asChild icon="settings" label="Settings" selected={activeId === "settings"}>
                <Link href="/settings" />
              </IconButton>
            }
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopAppBar
            title="Intervue"
            titleAs="p"
            hideTitleOnCompact
            scrollRef={mainRef}
            leading={
              compact ? <IconButton icon="menu" label="Open navigation" onClick={() => setDrawerOpen(true)} /> : undefined
            }
            trailing={
              <>
                {orgSwitcher ?? <DefaultOrgSwitcher />}
                <ThemeToggle />
                {avatarMenu ?? <DefaultAvatarMenu />}
              </>
            }
          >
            <SearchBar
              value={search}
              onValueChange={setSearch}
              placeholder="Search candidates, roles…"
              containerClassName="mx-auto h-12 max-w-xl"
            />
          </TopAppBar>

          {banner}

          <main id="main" ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
            {/* Fade through between top-level destinations (enter animation keyed by destination). */}
            <motion.div
              key={topLevel}
              variants={fade}
              initial="initial"
              animate="animate"
              className="h-full"
            >
              {children}
            </motion.div>
          </main>

          {compact && (
            <div className="relative">
              <div className="absolute -top-20 right-4 z-20">
                <NewMenu side="top">
                  <Fab icon="add" label="New" color="tertiary" />
                </NewMenu>
              </div>
              <NavigationBar destinations={DESTINATIONS} activeId={activeId} renderLink={renderLink} />
            </div>
          )}
        </div>
      </div>

      <NavigationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        headline="Intervue"
        destinations={DRAWER_DESTINATIONS}
        activeId={activeId}
        renderLink={renderLink}
        onNavigate={() => setDrawerOpen(false)}
      />
    </div>
  );
}
