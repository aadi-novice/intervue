"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Sparkles, Search, Loader2, Users, Clock, Filter, SortDesc, CalendarDays, Star, ArrowDownAZ, Trash2, Briefcase } from "lucide-react";
import { api, type PipelineCandidate } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STAGE_COLORS: Record<string, string> = {
  applied:   "#8c909f",
  screening: "#f59e0b",
  interview: "#3b82f6",
  offer:     "#10b981",
  hired:     "#a78bfa",
};
const STAGE_LABELS: Record<string, string> = {
  applied:   "Applied",
  screening: "AI Screening",
  interview: "Interview",
  offer:     "Offer",
  hired:     "Hired",
};

export default function TalentPoolPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recent");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.candidates.list().then(setCandidates).finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  let processed = candidates.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
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
    <div className="p-6 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold text-[#e1e2ec]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
          >
            Talent Pool
          </h1>
          <p className="text-[#8c909f] text-sm mt-0.5">
            {loading ? "Loading…" : `${candidates.length} candidates across all roles`}
          </p>
        </div>
        <Link
          href="/candidate/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#3b82f6] text-white text-sm font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow"
        >
          + Add Candidate
        </Link>
        
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="flex items-center gap-2 bg-[#272a31] border border-[#424754] rounded-xl px-4 py-2.5 w-full md:max-w-sm focus-within:border-[#3b82f6] transition-colors">
          <Search className="w-4 h-4 text-[#8c909f] flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or role…"
            className="bg-transparent text-sm text-[#e1e2ec] placeholder-[#424754] outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <Select value={filterStage} onValueChange={setFilterStage}>
            <SelectTrigger className="w-[160px] bg-[#272a31] border-[#424754] text-[#e1e2ec] focus:ring-1 focus:ring-[#3b82f6]">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#8c909f]" />
                <SelectValue placeholder="Stage" />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#22252b] border-[#32353c] text-[#e1e2ec]">
              <SelectItem value="all">All Stages</SelectItem>
              {Object.entries(STAGE_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[180px] bg-[#272a31] border-[#424754] text-[#e1e2ec] focus:ring-1 focus:ring-[#3b82f6]">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-[#8c909f]" />
                <SelectValue placeholder="Role" />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#22252b] border-[#32353c] text-[#e1e2ec]">
              <SelectItem value="all">All Roles</SelectItem>
              {uniqueRoles.map((role) => (
                <SelectItem key={role} value={role}>{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px] bg-[#272a31] border-[#424754] text-[#e1e2ec] focus:ring-1 focus:ring-[#3b82f6]">
              <div className="flex items-center gap-2">
                <SortDesc className="w-4 h-4 text-[#8c909f]" />
                <SelectValue placeholder="Sort by" />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#22252b] border-[#32353c] text-[#e1e2ec]">
              <SelectItem value="recent">
                <div className="flex items-center gap-2"><CalendarDays className="w-3.5 h-3.5" /> Most Recent</div>
              </SelectItem>
              <SelectItem value="score-desc">
                <div className="flex items-center gap-2"><Star className="w-3.5 h-3.5" /> Highest Score</div>
              </SelectItem>
              <SelectItem value="score-asc">
                <div className="flex items-center gap-2"><Star className="w-3.5 h-3.5" /> Lowest Score</div>
              </SelectItem>
              <SelectItem value="name-asc">
                <div className="flex items-center gap-2"><ArrowDownAZ className="w-3.5 h-3.5" /> Name (A-Z)</div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-[#8c909f] py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading candidates…
        </div>
      ) : processed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[#8c909f]">
          <Users className="w-8 h-8 mb-3" />
          <p className="text-sm">{search ? "No candidates match your search" : "No candidates yet"}</p>
          <Link href="/candidate/new" className="mt-3 text-[#3b82f6] text-sm hover:underline">
            Add your first candidate →
          </Link>
        </div>
      ) : (
        <div className="nh-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#424754]">
                {["Candidate", "Role", "Stage", "Score", "Days", "AI", ""].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#424754] uppercase tracking-wider px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processed.map((c, i) => {
                const scoreColor =
                  c.score >= 90 ? "#10b981" : c.score >= 80 ? "#3b82f6" : c.score > 0 ? "#f59e0b" : "#424754";
                return (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-[#424754]/40 hover:bg-[#272a31] transition-colors group"
                  >
                    <td className="px-5 py-3">
                      <Link href={`/candidate/${c.id}`} className="flex items-center gap-3 group">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}88)` }}
                        >
                          {c.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#e1e2ec] group-hover:text-[#3b82f6] transition-colors">
                            {c.name}
                          </p>
                          <p className="text-[11px] text-[#8c909f]">{c.email}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-sm text-[#c2c6d6]">{c.role}</td>
                    <td className="px-5 py-3">
                      <span
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                        style={{
                          background: `${STAGE_COLORS[c.stage] ?? "#8c909f"}18`,
                          color: STAGE_COLORS[c.stage] ?? "#8c909f",
                          border: `1px solid ${STAGE_COLORS[c.stage] ?? "#8c909f"}33`,
                        }}
                      >
                        {STAGE_LABELS[c.stage] ?? c.stage}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm font-bold" style={{ color: scoreColor }}>
                        {c.score > 0 ? `${c.score}%` : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1 text-xs text-[#8c909f]">
                        <Clock className="w-3 h-3" />
                        {c.days}d
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {c.ai ? (
                        <Sparkles className="w-4 h-4 text-[#a78bfa]" />
                      ) : (
                        <span className="text-xs text-[#424754]">—</span>
                      )}
                    </td>
                    {/* Delete */}
                    <td className="px-3 py-3">
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-[#f43f5e]/10 text-[#424754] hover:text-[#f43f5e] disabled:opacity-40"
                        title="Delete candidate"
                      >
                        {deletingId === c.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
