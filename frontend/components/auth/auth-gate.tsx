"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  CandidateAvatar,
  Icon,
  LoadingRegion,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  useSnackbar,
} from "@/components/m3";
import AppShell from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { applyOrgTheme } from "@/lib/org-theme";
import { currentOrg, useAuthStore } from "@/lib/auth-store";
import { usePipelineStore } from "@/lib/pipeline-store";
import { ROLE_LABELS } from "@/lib/roles";
import { errorMessage, useLogout, useMe, useResendVerification, useSwitchOrg } from "@/lib/queries/auth";

function PageSkeleton() {
  return (
    <LoadingRegion label="Loading your workspace" className="space-y-4 p-4 medium:p-6">
      <Skeleton className="h-9 w-64 rounded-sm" />
      <div className="grid gap-4 medium:grid-cols-3">
        <Skeleton className="h-32 rounded-md" />
        <Skeleton className="h-32 rounded-md" />
        <Skeleton className="h-32 rounded-md" />
      </div>
      <Skeleton className="h-72 rounded-md" />
    </LoadingRegion>
  );
}

function OrgSwitcher() {
  const orgs = useAuthStore((s) => s.orgs);
  const org = useAuthStore((s) => currentOrg(s));
  const switchOrg = useSwitchOrg();
  if (!org) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organization: ${org.name}. Switch organization`}
          className="focus-ring hidden h-8 max-w-48 items-center gap-2 rounded-sm border border-outline-variant px-3 label-l text-on-surface-variant hover:bg-on-surface/8 medium:inline-flex"
        >
          <Icon name="domain" size={18} />
          <span className="truncate">{org.name}</span>
          <Icon name="arrow_drop_down" size={18} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Organizations</MenuLabel>
        <MenuRadioGroup value={String(org.id)} onValueChange={(v) => switchOrg(Number(v))}>
          {orgs.map((o) => (
            <MenuRadioItem key={o.id} value={String(o.id)}>
              {o.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function AvatarMenu() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const org = useAuthStore((s) => currentOrg(s));
  const logout = useLogout();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="Account menu" className="focus-ring ms-1 rounded-full">
          <CandidateAvatar name={user.full_name || user.email} src={user.avatar_url} size="sm" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-60">
        <div className="px-3 py-2">
          <p className="truncate title-s">{user.full_name}</p>
          <p className="truncate body-s text-on-surface-variant">{user.email}</p>
          {org && (
            <p className="mt-1 truncate label-s text-on-surface-variant">
              {org.name} · {ROLE_LABELS[org.role]}
            </p>
          )}
        </div>
        <MenuSeparator />
        <MenuItem leadingIcon="settings" onSelect={() => router.push("/settings")}>
          Settings
        </MenuItem>
        <MenuItem
          leadingIcon="logout"
          onSelect={() => logout.mutate(undefined, { onSettled: () => router.replace("/login") })}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function VerifyBanner() {
  const resend = useResendVerification();
  const snackbar = useSnackbar();
  return (
    <div
      role="region"
      aria-label="Email verification"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-tertiary-container px-4 py-2 text-on-tertiary-container"
    >
      <Icon name="mail" size={20} />
      <p className="min-w-0 flex-1 body-m">Verify your email address to secure your account. Check your inbox for the link.</p>
      <Button
        variant="text"
        size="sm"
        loading={resend.isPending}
        className="text-on-tertiary-container"
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => snackbar.show("Verification email sent"),
            onError: (e) => snackbar.show(errorMessage(e)),
          })
        }
      >
        Resend
      </Button>
    </div>
  );
}

/** Loads the session, redirects when org-less, applies the org theme and wires the shell slots. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const orgId = useAuthStore((s) => s.currentOrgId);
  const org = useAuthStore((s) => currentOrg(s));
  const seed = org?.settings?.seed_color;
  const noOrgs = me.isSuccess && me.data.orgs.length === 0;

  useEffect(() => {
    if (noOrgs) router.replace("/onboarding");
  }, [noOrgs, router]);

  useEffect(() => {
    applyOrgTheme(seed);
  }, [seed]);

  // Pipeline cache is org-scoped Zustand state: clear it when the org changes.
  const lastOrg = useRef(orgId);
  useEffect(() => {
    if (lastOrg.current !== orgId) {
      lastOrg.current = orgId;
      usePipelineStore.setState({ candidates: [], error: null });
    }
  }, [orgId]);

  const ready = me.isSuccess && !noOrgs && orgId != null;

  let content: React.ReactNode;
  if (ready) {
    // Remount the page tree when the org changes so every page refetches its data.
    content = <div key={orgId} className="contents">{children}</div>;
  } else if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) {
    // (a 401 means the api client is already redirecting to /login; keep the skeleton)
    content = (
      <div className="p-6">
        <p role="alert" className="body-m text-error">
          {errorMessage(me.error)}
        </p>
        <Button className="mt-3" variant="tonal" onClick={() => me.refetch()}>
          Retry
        </Button>
        <Link href="/login" className="ms-3 label-l text-primary hover:underline">
          Sign in again
        </Link>
      </div>
    );
  } else {
    content = <PageSkeleton />;
  }

  return (
    <AppShell
      orgSwitcher={ready ? <OrgSwitcher /> : <span className="hidden size-8 medium:inline-block" />}
      avatarMenu={ready ? <AvatarMenu /> : <Skeleton className="ms-1 size-8 rounded-full" />}
      banner={ready && me.data && !me.data.user.email_verified ? <VerifyBanner /> : undefined}
    >
      {content}
    </AppShell>
  );
}
