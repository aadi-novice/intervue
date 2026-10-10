"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Button, Card, EmptyState, Icon, LinearProgress, LoadingRegion, PageHeader, Skeleton, StaggerItem } from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { RoleStatusChip } from "@/components/ranking/role-status-chip";
import { apiMessage, rankingApi } from "@/lib/api-ranking";
import { rk, useOrgId, usePool, useRoles } from "@/lib/queries/ranking";
import { CAN } from "@/lib/roles";

export default function RolesPage() {
  const org = useOrgId();
  const roles = useRoles();
  const pool = usePool();
  const list = roles.data ?? [];
  const progress = useQueries({
    queries: list.map((r) => ({
      queryKey: [...rk.rankingsAll(org, r.id), "summary"],
      queryFn: () => rankingApi.rank.rankings(r.id, { limit: 1 }),
      enabled: org != null,
    })),
  });
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of pool.data ?? []) m.set(c.role_id, (m.get(c.role_id) ?? 0) + 1);
    return m;
  }, [pool.data]);

  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Roles"
        subtitle={roles.isLoading ? "Loading…" : `${list.length} role${list.length === 1 ? "" : "s"}`}
        actions={
          <RequireRole roles={CAN.create}>
            <Button asChild icon="add">
              <Link href="/roles/new">New role</Link>
            </Button>
          </RequireRole>
        }
      />
      {roles.isLoading ? (
        <LoadingRegion label="Loading roles" className="grid gap-4 medium:grid-cols-2 large:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-md" />
          ))}
        </LoadingRegion>
      ) : roles.isError ? (
        <EmptyState icon="error" title="Could not load roles">
          {apiMessage(roles.error)}
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState icon="work" title="No roles yet">
          <RequireRole roles={CAN.create} fallback="Ask a recruiter to create the first role.">
            <Link href="/roles/new" className="text-primary hover:underline">
              Create your first role →
            </Link>
          </RequireRole>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 medium:grid-cols-2 large:grid-cols-3">
          {list.map((r, i) => {
            const p = progress[i]?.data;
            const pct = p && p.total > 0 ? (p.scored_count / p.total) * 100 : 0;
            return (
              <StaggerItem as="li" key={r.id} index={i}>
                <Link href={`/roles/${r.id}`} className="focus-ring block rounded-md">
                  <Card variant="outlined" className="h-full space-y-3 p-4 transition-colors hover:bg-on-surface/4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="min-w-0 truncate title-m text-on-surface">{r.name}</h2>
                      <RoleStatusChip status={r.status} />
                    </div>
                    <p className="body-s capitalize text-on-surface-variant">
                      {r.experience_level} · {r.experience_required_years}+ yrs
                    </p>
                    <p className="flex items-center gap-1 label-l text-on-surface">
                      <Icon name="groups" size={18} className="text-on-surface-variant" />
                      {counts.get(r.id) ?? p?.total ?? 0} candidates
                    </p>
                    <div>
                      <p className="mb-1 label-m text-on-surface-variant">
                        Ranking: {p ? `${p.scored_count}/${p.total} scored` : "…"}
                      </p>
                      <LinearProgress value={pct} aria-label={`${r.name} ranking progress`} />
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            );
          })}
        </ul>
      )}
    </div>
  );
}
