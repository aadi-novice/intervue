"use client";

import { useEffect, useState } from "react";
import { FilterChip, PageHeader, SearchBar } from "@/components/m3";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { usePipelineStore } from "@/lib/pipeline-store";
import { api, type Role } from "@/lib/api";

export default function PipelinePage() {
  const count = usePipelineStore((s) => s.candidates.length);
  const loading = usePipelineStore((s) => s.loading);
  const [roles, setRoles] = useState<Role[]>([]);
  const [filterRoleId, setFilterRoleId] = useState<number | null>(null); // null = All
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.roles.list().then(setRoles).catch(() => {});
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 medium:p-6">
      <PageHeader
        title="Pipeline"
        subtitle={loading && count === 0 ? "Loading…" : `Drag to move · click to view · ${count} candidates`}
        actions={
          <SearchBar value={search} onValueChange={setSearch} placeholder="Search candidates…" containerClassName="h-12 w-60" />
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Filter by role">
        <FilterChip label="All Roles" selected={filterRoleId === null} onSelectedChange={() => setFilterRoleId(null)} />
        {roles.map((r) => (
          <FilterChip key={r.id} label={r.name} selected={filterRoleId === r.id} onSelectedChange={() => setFilterRoleId(r.id)} />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PipelineBoard roleId={filterRoleId} search={search} />
      </div>
    </div>
  );
}
