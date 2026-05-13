"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles, TrendingUp, Users, Briefcase,
  Clock, ArrowRight, ChevronRight, Zap, Target,
} from "lucide-react";
import { api, type Role, type PipelineCandidate } from "@/lib/api";

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1 bg-[#32353c] rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

export default function DashboardPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);

  useEffect(() => {
    api.roles.list().then(setRoles).catch(() => {});
    api.candidates.list().then(setCandidates).catch(() => {});
  }, []);

  // Compute stats from live data
  const totalCandidates = candidates.length;
  const aiMatches = candidates.filter((c) => c.ai && c.score >= 85).length;
  const totalRoles = roles.length;

  // Compute candidate count per role
  const candidatesByRole: Record<number, number> = {};
  candidates.forEach((c) => {
    candidatesByRole[c.role_id] = (candidatesByRole[c.role_id] ?? 0) + 1;
  });

  // Average score per role (for "AI Score" on role card)
  const scoreByRole: Record<number, number> = {};
  roles.forEach((r) => {
    const roleCands = candidates.filter((c) => c.role_id === r.id && c.score > 0);
    if (roleCands.length > 0) {
      scoreByRole[r.id] = Math.round(roleCands.reduce((s, c) => s + c.score, 0) / roleCands.length);
    }
  });

  // Most recent 4 candidates
  const recentCandidates = [...candidates].slice(0, 4);

  // Best candidate for AI insight
  const best = candidates.filter((c) => c.ai && c.score > 0).sort((a, b) => b.score - a.score)[0];

  const STATS = [
    { label: "Active Roles",     value: String(totalRoles),     sub: "Across your workspace",      icon: Briefcase, color: "#3b82f6" },
    { label: "Total Candidates", value: String(totalCandidates), sub: "Across all roles",           icon: Users,     color: "#a78bfa" },
    { label: "AI Matches",       value: String(aiMatches),       sub: "≥85% match score",           icon: Zap,       color: "#10b981" },
    { label: "Avg. Time-to-Hire", value: "—",                   sub: "Calculated after first hire", icon: Clock,     color: "#f59e0b" },
  ];

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="p-6 space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>
            Dashboard
          </h1>
          <p className="text-[#8c909f] text-sm mt-0.5">AI Recruitment · {today}</p>
        </div>
        <div className="flex items-center gap-2 ai-badge ai-pulse">
          <Sparkles className="w-3.5 h-3.5" />
          AI Engine Active
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="nh-card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-[#8c909f] font-mono tracking-wider uppercase">{stat.label}</p>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${stat.color}18` }}>
                <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
              </div>
            </div>
            <p className="text-3xl font-bold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.04em" }}>
              {stat.value}
            </p>
            <p className="text-xs text-[#8c909f] mt-1">{stat.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Active Roles */}
        <div className="col-span-3 nh-card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)" }}>
              Active Roles
            </h2>
            <Link href="/roles/new" className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline">
              + New Role <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {roles.length === 0 && (
              <p className="text-sm text-[#424754] text-center py-6">
                No roles yet. <Link href="/roles/new" className="text-[#3b82f6] hover:underline">Post one →</Link>
              </p>
            )}
            {roles.map((role, i) => {
              const count = candidatesByRole[role.id] ?? 0;
              const aiScore = scoreByRole[role.id] ?? 0;
              const daysOld = Math.floor((Date.now() - new Date(role.created_at).getTime()) / 86400000);
              const scoreColor = aiScore >= 90 ? "#10b981" : aiScore >= 80 ? "#3b82f6" : "#f59e0b";
              return (
                <motion.div key={role.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }}>
                  <Link href="/dashboard/pipeline">
                    <div className="nh-card-inner p-4 hover:border-[#3b82f6]/40 transition-all cursor-pointer group">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-[#e1e2ec] group-hover:text-[#3b82f6] transition-colors">
                            {role.name}
                          </p>
                          <p className="text-xs text-[#8c909f] mt-0.5 capitalize">{role.experience_level} · {role.experience_required_years}+ yrs</p>
                        </div>
                        {aiScore > 0 && (
                          <div className="text-right">
                            <div className="flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-[#a78bfa]" />
                              <span className="text-sm font-bold" style={{ color: "#a78bfa" }}>{aiScore}%</span>
                            </div>
                            <p className="text-[10px] text-[#8c909f] mt-0.5">Avg Score</p>
                          </div>
                        )}
                      </div>

                      {aiScore > 0 && <ScoreBar value={aiScore} color={scoreColor} />}

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex gap-1.5 flex-wrap">
                          <span className="skill-tag capitalize">{role.experience_level}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[#8c909f]">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> {count}
                          </span>
                          <span className="flex items-center gap-1">
                            <Target className="w-3 h-3 text-[#10b981]" />
                            {candidates.filter((c) => c.role_id === role.id && c.ai).length} AI
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {daysOld}d
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>

          <Link
            href="/roles/new"
            className="mt-4 flex items-center justify-center gap-2 border border-dashed border-[#424754] rounded-xl py-3 text-sm text-[#8c909f] hover:border-[#3b82f6] hover:text-[#3b82f6] transition-all"
          >
            + Post New Role
          </Link>
        </div>

        {/* Right column */}
        <div className="col-span-2 flex flex-col gap-4">
          {/* AI Insight — best candidate */}
          <div className="nh-card p-5 nh-ai-glow" style={{ border: "1px solid rgba(167, 139, 250, 0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-[#a78bfa]/10 border border-[#a78bfa]/30 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />
              </div>
              <span className="text-xs font-semibold text-[#a78bfa] tracking-wider uppercase">AI Insight</span>
            </div>
            {best ? (
              <>
                <p className="text-sm text-[#c2c6d6] leading-relaxed">
                  <span className="text-[#e1e2ec] font-semibold">{best.name}</span> has a{" "}
                  <span className="font-bold" style={{ color: best.score >= 90 ? "#10b981" : "#3b82f6" }}>{best.score}%</span>{" "}
                  AI match for <span className="text-[#e1e2ec]">{best.role}</span> — your top-ranked candidate right now.
                </p>
                <div className="mt-3 pt-3 border-t border-[#424754] flex items-center justify-between">
                  <span className="text-[10px] text-[#8c909f] mono">Live · AI Engine</span>
                  <Link href={`/candidate/${best.id}`} className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline">
                    View <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#424754]">Add candidates and run analysis to see AI insights.</p>
            )}
          </div>

          {/* Recent Activity */}
          <div className="nh-card p-5 flex-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)" }}>
                Recent Activity
              </h2>
              <Link href="/dashboard/candidates" className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline">
                All <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            {recentCandidates.length === 0 && (
              <p className="text-sm text-[#424754] text-center py-6">
                No candidates yet. <Link href="/candidate/new" className="text-[#3b82f6] hover:underline">Add one →</Link>
              </p>
            )}

            <div className="space-y-3">
              {recentCandidates.map((c, i) => {
                const scoreColor = c.score >= 90 ? "#10b981" : c.score >= 80 ? "#3b82f6" : c.score > 0 ? "#f59e0b" : "#424754";
                return (
                  <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.07 }}>
                    <Link href={`/candidate/${c.id}`}>
                      <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-[#272a31] transition-all cursor-pointer group">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}88)` }}
                        >
                          {c.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-[#e1e2ec] truncate group-hover:text-[#3b82f6] transition-colors">
                              {c.name}
                            </p>
                            {c.ai && <Sparkles className="w-3 h-3 text-[#a78bfa] flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-[#8c909f] truncate">{c.role} · {c.stage}</p>
                        </div>
                        <span className="text-sm font-bold flex-shrink-0" style={{ color: scoreColor }}>
                          {c.score > 0 ? `${c.score}%` : "—"}
                        </span>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Hiring Velocity (static chart — decorative) */}
      <div className="nh-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#e1e2ec] flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <TrendingUp className="w-4 h-4 text-[#3b82f6]" />
            Hiring Velocity
          </h2>
          <div className="flex gap-2">
            {["7d", "30d", "90d"].map((p, i) => (
              <button key={p} className={`text-xs px-3 py-1 rounded-md transition-all ${i === 1 ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30" : "text-[#8c909f] hover:text-[#e1e2ec]"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-6">
          {[
            { day: "Mon", apps: 8,  matches: 3 },
            { day: "Tue", apps: 14, matches: 5 },
            { day: "Wed", apps: 11, matches: 4 },
            { day: "Thu", apps: 19, matches: 7 },
            { day: "Fri", apps: 16, matches: 6 },
            { day: "Sat", apps: 5,  matches: 2 },
            { day: "Sun", apps: 3,  matches: 1 },
          ].map((d, i) => {
            const maxApps = 19;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center gap-0.5" style={{ height: 80 }}>
                  <div className="flex-1 w-full flex flex-col justify-end gap-0.5">
                    <motion.div initial={{ height: 0 }} animate={{ height: `${(d.matches / maxApps) * 100}%` }} transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }} className="w-full rounded-t-sm bg-[#a78bfa]/60" />
                    <motion.div initial={{ height: 0 }} animate={{ height: `${((d.apps - d.matches) / maxApps) * 100}%` }} transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }} className="w-full rounded-t-sm bg-[#3b82f6]/30" />
                  </div>
                </div>
                <span className="text-[10px] text-[#8c909f] mono">{d.day}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs text-[#8c909f]">
            <span className="w-3 h-2 rounded-sm bg-[#3b82f6]/30 inline-block" /> Applications
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#8c909f]">
            <span className="w-3 h-2 rounded-sm bg-[#a78bfa]/60 inline-block" /> AI Matches
          </div>
        </div>
      </div>
    </div>
  );
}
