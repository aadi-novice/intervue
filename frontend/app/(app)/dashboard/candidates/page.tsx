"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Button,
  CandidateAvatar,
  Card,
  EmptyState,
  Icon,
  IconButton,
  LoadingRegion,
  PageHeader,
  SearchBar,
  Select,
  Skeleton,
  StaggerItem,
  scoreTone,
  stageTone,
  toneText,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import { api, type PipelineCandidate } from "@/lib/api";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

export default function TalentPoolPage() {
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recent");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.candidates
      .list()
      .then(setCandidates)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (c: PipelineCandidate) => {
    if (!confirm(`Remove ${c.name} from the talent pool? This will delete all their data, analyses, and files.`)) return;
    setDeletingId(c.id);
    try {
      await api.candidates.delete(c.id);
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const uniqueRoles = Array.from(new Set(candidates.map((c) => c.role))).sort();

  const processed = candidates.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
    const matchesStage = filterStage === "all" || c.stage === filterStage;
    const matchesRole = filterRole === "all" || c.role === filterRole;
    return matchesSearch && matchesStage && matchesRole;
  });

  processed.sort((a, b) => {
    if (sortBy === "recent") return a.days - b.days;
    if (sortBy === "score-desc") return b.score - a.score;
    if (sortBy === "score-asc") return a.score - b.score;
    if (sortBy === "name-asc") return a.name.localeCompare(b.name);
    return 0;
  });

  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Talent Pool"
        subtitle={loading ? "Loading…" : `${candidates.length} candidates across all roles`}
        actions={
          <Button asChild icon="add">
            <Link href="/candidate/new">Add Candidate</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 expanded:flex-row expanded:items-start">
        <SearchBar
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name or role…"
          containerClassName="expanded:max-w-sm"
        />
        <div className="flex flex-wrap gap-3">
          <Select
            className="w-44"
            label="Stage"
            leadingIcon="filter_list"
            value={filterStage}
            onValueChange={setFilterStage}
            options={[{ value: "all", label: "All Stages" }, ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))]}
          />
          <Select
            className="w-48"
            label="Role"
            leadingIcon="work"
            value={filterRole}
            onValueChange={setFilterRole}
            options={[{ value: "all", label: "All Roles" }, ...uniqueRoles.map((r) => ({ value: r, label: r }))]}
          />
          <Select
            className="w-48"
            label="Sort by"
            leadingIcon="sort"
            value={sortBy}
            onValueChange={setSortBy}
            options={[
              { value: "recent", label: "Most Recent", icon: "calendar_month" },
              { value: "score-desc", label: "Highest Score", icon: "star" },
              { value: "score-asc", label: "Lowest Score", icon: "star" },
              { value: "name-asc", label: "Name (A-Z)", icon: "sort_by_alpha" },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <LoadingRegion label="Loading candidates" className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </LoadingRegion>
      ) : processed.length === 0 ? (
        <EmptyState icon="groups" title={search ? "No candidates match your search" : "No candidates yet"}>
          <Link href="/candidate/new" className="text-primary hover:underline">
            Add your first candidate →
          </Link>
        </EmptyState>
      ) : (
        <Card variant="outlined" className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-outline-variant">
                {["Candidate", "Role", "Stage", "Score", "Days", "AI", ""].map((h, i) => (
                  <th key={i} scope="col" className="px-5 py-3 text-left label-m uppercase text-on-surface-variant">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processed.map((c, i) => (
                <StaggerItem
                  as="tr"
                  key={c.id}
                  index={i}
                  className="group border-b border-outline-variant/50 transition-colors last:border-0 hover:bg-on-surface/4"
                >
                  <td className="px-5 py-3">
                    <Link href={`/candidate/${c.id}`} className="focus-ring flex items-center gap-3 rounded-md">
                      <CandidateAvatar name={c.name} initials={c.avatar} size="sm" />
                      <div>
                        <p className="title-s text-on-surface">{c.name}</p>
                        <p className="body-s text-on-surface-variant">{c.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3 body-m text-on-surface-variant">{c.role}</td>
                  <td className="px-5 py-3">
                    <span className={cn("inline-flex h-6 items-center rounded-sm px-2 label-m", stageTone(c.stage).chip)}>
                      {STAGE_LABELS[c.stage] ?? c.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("title-s tabular-nums", toneText[scoreTone(c.score)])}>
                      {c.score > 0 ? `${c.score}%` : "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 label-m text-on-surface-variant">
                      <Icon name="schedule" size={14} />
                      {c.days}d
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {c.ai ? (
                      <Icon name="psychology" size={20} filled className="text-ai" label="AI analysed" />
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <IconButton
                      icon="delete"
                      label={`Delete ${c.name}`}
                      size="sm"
                      className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-error"
                      disabled={deletingId === c.id}
                      onClick={() => handleDelete(c)}
                    />
                  </td>
                </StaggerItem>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
