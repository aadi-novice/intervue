"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  ArrowLeft,
  ChevronRight,
  Star,
  TrendingUp,
  Minus,
  TrendingDown,
} from "lucide-react";

const CANDIDATES = [
  {
    id: "c1",
    name: "Priya Sharma",
    avatar: "PS",
    color: "#3b82f6",
    title: "Staff Eng @ Cloudflare",
    score: 96,
    technical: 97,
    culture: 88,
    growth: 94,
    experience: "7 yrs",
    education: "M.S. Stanford",
    skills: ["Rust", "Tokio", "WebAssembly", "gRPC", "K8s"],
    pros: ["Deep Rust expertise", "OSS Tokio contributor", "Distributed systems"],
    cons: ["Salary expectations high"],
    stage: "Technical Interview",
    rec: "strong_hire",
  },
  {
    id: "c2",
    name: "David Chen",
    avatar: "DC",
    color: "#a78bfa",
    title: "Senior Eng @ Stripe",
    score: 83,
    technical: 85,
    culture: 91,
    growth: 79,
    experience: "5 yrs",
    education: "B.S. MIT",
    skills: ["Rust", "Go", "gRPC", "Postgres", "AWS"],
    pros: ["Strong culture fit", "Fast learner", "FinTech scale"],
    cons: ["Limited WebAssembly exp.", "Shorter track record"],
    stage: "AI Screening",
    rec: "hire",
  },
  {
    id: "c3",
    name: "Asel Nurlanovna",
    avatar: "AN",
    color: "#f59e0b",
    title: "Backend Eng @ Canva",
    score: 81,
    technical: 78,
    culture: 84,
    growth: 88,
    experience: "4 yrs",
    education: "B.S. KAIST",
    skills: ["Rust", "Python", "gRPC", "Docker", "Redis"],
    pros: ["High growth potential", "Rust hobbyist", "Strong fundamentals"],
    cons: ["No production Rust", "Limited distributed systems"],
    stage: "HR Screen",
    rec: "consider",
  },
];

const REC_CONFIG: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  strong_hire: { label: "Strong Hire", color: "#10b981", icon: TrendingUp },
  hire: { label: "Hire", color: "#3b82f6", icon: TrendingUp },
  consider: { label: "Consider", color: "#f59e0b", icon: Minus },
  no_hire: { label: "No Hire", color: "#f43f5e", icon: TrendingDown },
};

const METRICS = [
  { key: "score", label: "AI Match Score", color: "#a78bfa" },
  { key: "technical", label: "Technical Depth", color: "#10b981" },
  { key: "culture", label: "Culture Fit", color: "#3b82f6" },
  { key: "growth", label: "Growth Potential", color: "#f59e0b" },
];

function MetricRow({
  label,
  color,
  values,
}: {
  label: string;
  color: string;
  values: number[];
}) {
  const max = Math.max(...values);
  return (
    <div className="grid grid-cols-4 gap-4 items-center py-3 border-b border-[#424754]/50 last:border-0">
      <div className="text-xs text-[#8c909f] mono">{label}</div>
      {values.map((v, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span
              className="text-lg font-bold"
              style={{
                color: v === max ? color : "#c2c6d6",
                fontFamily: "var(--font-heading)",
                letterSpacing: "-0.03em",
              }}
            >
              {v}
              <span className="text-xs font-normal text-[#8c909f] ml-0.5">%</span>
            </span>
            {v === max && (
              <span className="text-[9px] text-[#10b981] font-bold uppercase tracking-wider">
                Best
              </span>
            )}
          </div>
          <div className="h-1 bg-[#32353c] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${v}%` }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="h-full rounded-full"
              style={{ backgroundColor: v === max ? color : `${color}55` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ComparePage() {
  return (
    <div className="p-6 fade-in">
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

      <div className="nh-card p-6">
        {/* Candidate headers */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-xs text-[#424754] mono uppercase tracking-wider pt-4">
            Sr. Rust Engineer
          </div>
          {CANDIDATES.map((c) => {
            const rec = REC_CONFIG[c.rec];
            return (
              <div key={c.id} className="text-center">
                <Link href={`/candidate/${c.id}`}>
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold mx-auto mb-2 text-lg hover:scale-105 transition-transform cursor-pointer"
                    style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}77)` }}
                  >
                    {c.avatar}
                  </div>
                  <p className="text-sm font-bold text-[#e1e2ec] hover:text-[#3b82f6] transition-colors">
                    {c.name}
                  </p>
                </Link>
                <p className="text-xs text-[#8c909f] mt-0.5">{c.title}</p>
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  <rec.icon className="w-3 h-3" style={{ color: rec.color }} />
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: rec.color }}
                  >
                    {rec.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Metrics comparison */}
        <div>
          {METRICS.map((m) => (
            <MetricRow
              key={m.key}
              label={m.label}
              color={m.color}
              values={CANDIDATES.map((c) => c[m.key as keyof typeof c] as number)}
            />
          ))}
        </div>

        {/* Detailed comparison rows */}
        <div className="mt-6 space-y-4">
          {/* Experience */}
          <div className="grid grid-cols-4 gap-4 py-3 border-b border-[#424754]/50">
            <div className="text-xs text-[#8c909f] mono">Experience</div>
            {CANDIDATES.map((c) => (
              <div key={c.id} className="text-center text-sm text-[#e1e2ec] font-semibold">
                {c.experience}
              </div>
            ))}
          </div>

          {/* Education */}
          <div className="grid grid-cols-4 gap-4 py-3 border-b border-[#424754]/50">
            <div className="text-xs text-[#8c909f] mono">Education</div>
            {CANDIDATES.map((c) => (
              <div key={c.id} className="text-center text-xs text-[#c2c6d6]">
                {c.education}
              </div>
            ))}
          </div>

          {/* Stage */}
          <div className="grid grid-cols-4 gap-4 py-3 border-b border-[#424754]/50">
            <div className="text-xs text-[#8c909f] mono">Stage</div>
            {CANDIDATES.map((c) => (
              <div key={c.id} className="text-center">
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#272a31] border border-[#424754] text-[#c2c6d6]">
                  {c.stage}
                </span>
              </div>
            ))}
          </div>

          {/* Skills */}
          <div className="grid grid-cols-4 gap-4 py-3 border-b border-[#424754]/50">
            <div className="text-xs text-[#8c909f] mono pt-1">Top Skills</div>
            {CANDIDATES.map((c) => (
              <div key={c.id} className="flex flex-wrap gap-1 justify-center">
                {c.skills.slice(0, 3).map((s) => (
                  <span key={s} className="skill-tag text-[10px]">
                    {s}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* Pros */}
          <div className="grid grid-cols-4 gap-4 py-3 border-b border-[#424754]/50">
            <div className="text-xs text-[#8c909f] mono pt-1">Strengths</div>
            {CANDIDATES.map((c) => (
              <ul key={c.id} className="space-y-1">
                {c.pros.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0 mt-1.5" />
                    {p}
                  </li>
                ))}
              </ul>
            ))}
          </div>

          {/* Cons */}
          <div className="grid grid-cols-4 gap-4 py-3">
            <div className="text-xs text-[#8c909f] mono pt-1">Considerations</div>
            {CANDIDATES.map((c) => (
              <ul key={c.id} className="space-y-1">
                {c.cons.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] flex-shrink-0 mt-1.5" />
                    {p}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* Action row */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-5 border-t border-[#424754]">
          <div />
          {CANDIDATES.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <Link
                href={`/candidate/${c.id}`}
                className="py-2 rounded-xl bg-[#272a31] border border-[#424754] text-[#c2c6d6] text-xs font-semibold text-center hover:bg-[#32353c] transition-colors"
              >
                View Profile
              </Link>
              {c.rec === "strong_hire" && (
                <button className="py-2 rounded-xl bg-[#3b82f6] text-white text-xs font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow">
                  Send Offer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
