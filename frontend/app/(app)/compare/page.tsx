"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  Minus,
  TrendingDown,
  Loader2,
  Users,
  CheckSquare,
  Square,
} from "lucide-react";
import { api, type Role, type PipelineCandidate, type CandidateDetail } from "@/lib/api";

// ── Helpers ─────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied", screening: "AI Screening", interview: "Interview",
  offer: "Offer", hired: "Hired",
};

function scoreToRec(score: number): "strong_hire" | "hire" | "consider" | "no_hire" {
  if (score >= 90) return "strong_hire";
  if (score >= 80) return "hire";
  if (score >= 65) return "consider";
  return "no_hire";
}

const REC_CONFIG: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  strong_hire: { label: "Strong Hire", color: "#10b981", icon: TrendingUp },
  hire:        { label: "Hire",        color: "#3b82f6", icon: TrendingUp },
  consider:    { label: "Consider",    color: "#f59e0b", icon: Minus },
  no_hire:     { label: "No Hire",     color: "#f43f5e", icon: TrendingDown },
};

const METRICS = [
  { key: "aggregate_score",    label: "AI Match Score",   color: "#a78bfa" },
  { key: "technical_score",    label: "Technical Depth",  color: "#10b981" },
  { key: "communication_score", label: "Communication",   color: "#3b82f6" },
  { key: "confidence_score",   label: "Confidence",       color: "#f59e0b" },
];

// ── MetricRow ────────────────────────────────────────────────────────────────

function MetricRow({ label, color, values }: { label: string; color: string; values: number[] }) {
  const max = Math.max(...values.filter((v) => v > 0));
  return (
    <div
      className="items-center py-3 border-b border-[#424754]/50 last:border-0"
      style={{ display: "grid", gridTemplateColumns: `160px repeat(${values.length}, 1fr)`, gap: "1rem" }}
    >
      <div className="text-xs text-[#8c909f] mono">{label}</div>
      {values.map((v, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold" style={{ color: v === max && v > 0 ? color : "#c2c6d6", fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>
              {v > 0 ? v : "—"}
              {v > 0 && <span className="text-xs font-normal text-[#8c909f] ml-0.5">%</span>}
            </span>
            {v === max && v > 0 && (
              <span className="text-[9px] text-[#10b981] font-bold uppercase tracking-wider">Best</span>
            )}
          </div>
          <div className="h-1 bg-[#32353c] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: v > 0 ? `${v}%` : "0%" }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="h-full rounded-full"
              style={{ backgroundColor: v === max && v > 0 ? color : `${color}55` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Candidate selector modal ─────────────────────────────────────────────────

function CandidateSelector({
  slot,
  roleId,
  roleCandidates,
  selected,
  onSelect,
  onClose,
}: {
  slot: 0 | 1;
  roleId: number | null;
  roleCandidates: PipelineCandidate[];
  selected: [string | null, string | null];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const otherSelected = selected[slot === 0 ? 1 : 0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="nh-card p-5 w-80 max-h-[420px] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-[#e1e2ec] mb-3">
          {roleId ? "Select candidate" : "Select a role first"}
        </p>
        {roleCandidates.length === 0 && roleId && (
          <p className="text-xs text-[#8c909f]">No candidates for this role yet.</p>
        )}
        <div className="space-y-2">
          {roleCandidates
            .filter((c) => c.id !== otherSelected)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); onClose(); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#272a31] transition-colors text-left border border-transparent hover:border-[#3b82f6]/30"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}88)` }}
                >
                  {c.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#e1e2ec]">{c.name}</p>
                  <p className="text-[11px] text-[#8c909f]">{STAGE_LABELS[c.stage] ?? c.stage} · {c.score > 0 ? `${c.score}%` : "no score"}</p>
                </div>
              </button>
            ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [allCandidates, setAllCandidates] = useState<PipelineCandidate[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selected, setSelected] = useState<[string | null, string | null]>([null, null]);
  const [details, setDetails] = useState<[CandidateDetail | null, CandidateDetail | null]>([null, null]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectorSlot, setSelectorSlot] = useState<0 | 1 | null>(null);

  // Load roles + all candidates once
  useEffect(() => {
    api.roles.list().then(setRoles).catch(() => {});
    api.candidates.list().then(setAllCandidates).catch(() => {});
  }, []);

  const roleCandidates = selectedRoleId
    ? allCandidates.filter((c) => c.role_id === selectedRoleId)
    : [];

  // When a candidate is selected in a slot, fetch their full detail
  const handleSelect = async (slot: 0 | 1, id: string) => {
    const next: [string | null, string | null] = [...selected] as [string | null, string | null];
    next[slot] = id;
    setSelected(next);

    setLoadingDetails(true);
    const fetched = await Promise.all(
      next.map((cid) => (cid ? api.candidates.get(cid).catch(() => null) : Promise.resolve(null)))
    );
    setDetails(fetched as [CandidateDetail | null, CandidateDetail | null]);
    setLoadingDetails(false);
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const comparisonReady = details[0] && details[1];

  // Extract metric values from a CandidateDetail
  const metricVal = (d: CandidateDetail | null, key: string): number => {
    if (!d?.analysis) return 0;
    return (d.analysis as unknown as Record<string, number>)[key] ?? 0;
  };

  return (
    <div className="p-6 fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 text-sm text-[#8c909f]">
          <Link href="/dashboard" className="hover:text-[#e1e2ec] transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#e1e2ec]">Comparison Matrix</span>
        </div>
        <div className="flex items-center gap-2 ai-badge">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Comparison
        </div>
      </div>

      {/* Step 1 — Pick role */}
      <div className="nh-card p-5 mb-4">
        <p className="text-xs font-semibold text-[#8c909f] uppercase tracking-wider mb-3">
          Step 1 — Select role to compare within
        </p>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelectedRoleId(r.id);
                setSelected([null, null]);
                setDetails([null, null]);
              }}
              className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
              style={
                selectedRoleId === r.id
                  ? { background: "#3b82f6", color: "#fff" }
                  : { background: "#272a31", border: "1px solid #424754", color: "#8c909f" }
              }
            >
              {r.name}
            </button>
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-[#424754]">No roles yet — <Link href="/roles/new" className="text-[#3b82f6]">post one</Link>.</p>
          )}
        </div>
      </div>

      {/* Step 2 — Pick two candidates */}
      {selectedRoleId && (
        <div className="nh-card p-5 mb-4">
          <p className="text-xs font-semibold text-[#8c909f] uppercase tracking-wider mb-3">
            Step 2 — Choose two candidates from <span className="text-[#e1e2ec]">{selectedRole?.name}</span>
            {" "}({roleCandidates.length} available)
          </p>
          <div className="flex gap-4">
            {([0, 1] as const).map((slot) => {
              const d = details[slot];
              const selId = selected[slot];
              const c = selId ? allCandidates.find((x) => x.id === selId) : null;
              return (
                <button
                  key={slot}
                  onClick={() => setSelectorSlot(slot)}
                  className="flex-1 flex items-center gap-3 p-4 rounded-xl border-2 border-dashed transition-all hover:border-[#3b82f6]/50"
                  style={{ borderColor: selId ? (c?.color ?? "#3b82f6") + "44" : "#32353c", background: selId ? (c?.color ?? "#3b82f6") + "08" : "transparent" }}
                >
                  {c ? (
                    <>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}88)` }}>
                        {c.avatar}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-[#e1e2ec]">{c.name}</p>
                        <p className="text-xs text-[#8c909f]">{STAGE_LABELS[c.stage] ?? c.stage}</p>
                      </div>
                      <CheckSquare className="w-4 h-4 text-[#3b82f6] ml-auto" />
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full bg-[#272a31] border border-[#424754] flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4 text-[#424754]" />
                      </div>
                      <p className="text-sm text-[#424754]">Candidate {slot + 1} — click to pick</p>
                      <Square className="w-4 h-4 text-[#32353c] ml-auto" />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selector modal */}
      {selectorSlot !== null && (
        <CandidateSelector
          slot={selectorSlot}
          roleId={selectedRoleId}
          roleCandidates={roleCandidates}
          selected={selected}
          onSelect={(id) => handleSelect(selectorSlot, id)}
          onClose={() => setSelectorSlot(null)}
        />
      )}

      {/* Loading details */}
      {loadingDetails && (
        <div className="flex items-center justify-center gap-2 text-[#8c909f] py-10">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading candidate profiles…
        </div>
      )}

      {/* Comparison matrix */}
      {!loadingDetails && comparisonReady && (() => {
        const [d0, d1] = details as [CandidateDetail, CandidateDetail];
        const candidates = [d0, d1];

        return (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="nh-card p-6">
            {/* Headers */}
            <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="mb-6">
              <div className="text-xs text-[#424754] mono uppercase tracking-wider pt-4">
                {selectedRole?.name}
              </div>
              {candidates.map((c) => {
                const rec = REC_CONFIG[scoreToRec(c.analysis?.aggregate_score ?? 0)];
                return (
                  <div key={c.id} className="text-center">
                    <Link href={`/candidate/${c.id}`}>
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold mx-auto mb-2 text-lg hover:scale-105 transition-transform cursor-pointer"
                        style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}77)` }}
                      >
                        {c.avatar}
                      </div>
                      <p className="text-sm font-bold text-[#e1e2ec] hover:text-[#3b82f6] transition-colors">{c.name}</p>
                    </Link>
                    <p className="text-xs text-[#8c909f] mt-0.5">{c.resume_profile?.basics?.headline ?? c.role}</p>
                    <div className="mt-2 flex items-center justify-center gap-1.5">
                      <rec.icon className="w-3 h-3" style={{ color: rec.color }} />
                      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: rec.color }}>
                        {rec.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Score metrics */}
            {METRICS.map((m) => (
              <MetricRow
                key={m.key}
                label={m.label}
                color={m.color}
                values={candidates.map((c) => metricVal(c, m.key))}
              />
            ))}

            {/* Detailed rows */}
            <div className="mt-6 space-y-0">
              {/* Stage */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3 border-b border-[#424754]/50">
                <div className="text-xs text-[#8c909f] mono">Stage</div>
                {candidates.map((c) => (
                  <div key={c.id} className="text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#272a31] border border-[#424754] text-[#c2c6d6]">
                      {STAGE_LABELS[c.stage] ?? c.stage}
                    </span>
                  </div>
                ))}
              </div>

              {/* Experience */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3 border-b border-[#424754]/50">
                <div className="text-xs text-[#8c909f] mono">Experience</div>
                {candidates.map((c) => (
                  <div key={c.id} className="text-center text-sm text-[#e1e2ec] font-semibold">
                    {c.resume_profile?.metadata?.total_experience_years != null
                      ? `${c.resume_profile.metadata.total_experience_years} yrs`
                      : "—"}
                  </div>
                ))}
              </div>

              {/* Education */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3 border-b border-[#424754]/50">
                <div className="text-xs text-[#8c909f] mono">Education</div>
                {candidates.map((c) => {
                  const ed = c.resume_profile?.education?.[0];
                  return (
                    <div key={c.id} className="text-center text-xs text-[#c2c6d6]">
                      {ed ? `${ed.degree}, ${ed.institution}` : "—"}
                    </div>
                  );
                })}
              </div>

              {/* Skills */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3 border-b border-[#424754]/50">
                <div className="text-xs text-[#8c909f] mono pt-1">Top Skills</div>
                {candidates.map((c) => {
                  const sk = c.resume_profile?.skills;
                  const tags = sk
                    ? [...(sk.programming_languages ?? []), ...(sk.frameworks ?? [])].slice(0, 4)
                    : [];
                  return (
                    <div key={c.id} className="flex flex-wrap gap-1 justify-center">
                      {tags.length > 0
                        ? tags.map((s) => <span key={s} className="skill-tag text-[10px]">{s}</span>)
                        : <span className="text-xs text-[#424754]">—</span>}
                    </div>
                  );
                })}
              </div>

              {/* Strengths */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3 border-b border-[#424754]/50">
                <div className="text-xs text-[#8c909f] mono pt-1">Strengths</div>
                {candidates.map((c) => (
                  <ul key={c.id} className="space-y-1">
                    {((c.analysis?.strengths ?? []) as string[]).slice(0, 3).map((p, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0 mt-1.5" />
                        {p}
                      </li>
                    ))}
                    {!c.analysis && <li className="text-xs text-[#424754]">No analysis yet</li>}
                  </ul>
                ))}
              </div>

              {/* Considerations */}
              <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="py-3">
                <div className="text-xs text-[#8c909f] mono pt-1">Considerations</div>
                {candidates.map((c) => (
                  <ul key={c.id} className="space-y-1">
                    {((c.analysis?.weaknesses ?? []) as string[]).slice(0, 3).map((p, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] flex-shrink-0 mt-1.5" />
                        {p}
                      </li>
                    ))}
                    {!c.analysis && <li className="text-xs text-[#424754]">—</li>}
                  </ul>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "grid", gridTemplateColumns: `160px repeat(2, 1fr)`, gap: "1rem" }} className="mt-6 pt-5 border-t border-[#424754]">
              <div />
              {candidates.map((c) => (
                <div key={c.id} className="flex flex-col gap-2">
                  <Link
                    href={`/candidate/${c.id}`}
                    className="py-2 rounded-xl bg-[#272a31] border border-[#424754] text-[#c2c6d6] text-xs font-semibold text-center hover:bg-[#32353c] transition-colors"
                  >
                    View Profile
                  </Link>
                  {(c.analysis?.aggregate_score ?? 0) >= 90 && (
                    <button className="py-2 rounded-xl bg-[#3b82f6] text-white text-xs font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow">
                      Send Offer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        );
      })()}

      {/* Prompt if not ready yet */}
      {!loadingDetails && !comparisonReady && selectedRoleId && (
        <div className="nh-card p-8 text-center">
          <Users className="w-8 h-8 text-[#32353c] mx-auto mb-3" />
          <p className="text-sm text-[#8c909f]">Select two candidates above to see their comparison matrix.</p>
        </div>
      )}
    </div>
  );
}
