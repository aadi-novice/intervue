"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  TrendingUp,
  Users,
  Briefcase,
  Clock,
  ArrowRight,
  ChevronRight,
  Star,
  Zap,
  Target,
} from "lucide-react";

const ROLES = [
  {
    id: "rust-eng",
    title: "Senior Rust Engineer",
    dept: "Platform & Infrastructure",
    candidates: 24,
    matched: 8,
    days: 12,
    status: "active",
    aiScore: 94,
    topSkills: ["Rust", "WebAssembly", "gRPC", "K8s"],
    urgency: "high",
  },
  {
    id: "product-design",
    title: "Lead Product Designer",
    dept: "Design",
    candidates: 37,
    matched: 11,
    days: 8,
    status: "active",
    aiScore: 87,
    topSkills: ["Figma", "Systems Design", "Motion", "Research"],
    urgency: "medium",
  },
  {
    id: "ml-ops",
    title: "Data Scientist, ML Ops",
    dept: "AI & Research",
    candidates: 19,
    matched: 6,
    days: 21,
    status: "active",
    aiScore: 91,
    topSkills: ["PyTorch", "MLflow", "Spark", "Kubeflow"],
    urgency: "low",
  },
];

const RECENT_CANDIDATES = [
  {
    id: "c1",
    name: "Priya Sharma",
    role: "Senior Rust Engineer",
    score: 96,
    stage: "Technical Interview",
    avatar: "PS",
    color: "#3b82f6",
    ai: true,
  },
  {
    id: "c2",
    name: "Marcus Webb",
    role: "Lead Product Designer",
    score: 89,
    stage: "Portfolio Review",
    avatar: "MW",
    color: "#a78bfa",
    ai: false,
  },
  {
    id: "c3",
    name: "Yuki Tanaka",
    role: "Data Scientist, ML Ops",
    score: 93,
    stage: "AI Screening",
    avatar: "YT",
    color: "#10b981",
    ai: true,
  },
  {
    id: "c4",
    name: "Asel Nurlanovna",
    role: "Senior Rust Engineer",
    score: 81,
    stage: "HR Screen",
    avatar: "AN",
    color: "#f59e0b",
    ai: false,
  },
];

const STATS = [
  { label: "Active Roles", value: "3", sub: "+1 this week", icon: Briefcase, color: "#3b82f6" },
  { label: "Total Candidates", value: "80", sub: "Across all roles", icon: Users, color: "#a78bfa" },
  { label: "AI Matches", value: "25", sub: "≥85% match score", icon: Zap, color: "#10b981" },
  { label: "Avg. Time-to-Hire", value: "14d", sub: "↓ 3d vs last month", icon: Clock, color: "#f59e0b" },
];

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
  return (
    <div className="p-6 space-y-6 fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-2xl font-semibold text-[#e1e2ec]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
          >
            Dashboard
          </h1>
          <p className="text-[#8c909f] text-sm mt-0.5">
            AI Recruitment · May 9, 2026
          </p>
        </div>
        <div className="flex items-center gap-2 ai-badge ai-pulse">
          <Sparkles className="w-3.5 h-3.5" />
          AI Engine Active
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="nh-card p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-[#8c909f] font-mono tracking-wider uppercase">
                {stat.label}
              </p>
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: `${stat.color}18` }}
              >
                <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
              </div>
            </div>
            <p
              className="text-3xl font-bold text-[#e1e2ec]"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.04em" }}
            >
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
            <h2
              className="text-base font-semibold text-[#e1e2ec]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Active Roles
            </h2>
            <Link
              href="/roles"
              className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline"
            >
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {ROLES.map((role, i) => (
              <motion.div
                key={role.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
              >
                <Link href={`/dashboard/pipeline?role=${role.id}`}>
                  <div className="nh-card-inner p-4 hover:border-[#3b82f6]/40 transition-all cursor-pointer group">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#e1e2ec] group-hover:text-[#3b82f6] transition-colors">
                            {role.title}
                          </p>
                          {role.urgency === "high" && (
                            <span className="match-pill match-weak text-[10px]">Urgent</span>
                          )}
                        </div>
                        <p className="text-xs text-[#8c909f] mt-0.5">{role.dept}</p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-[#a78bfa]" />
                          <span className="text-sm font-bold" style={{ color: "#a78bfa" }}>
                            {role.aiScore}%
                          </span>
                        </div>
                        <p className="text-[10px] text-[#8c909f] mt-0.5">AI Match</p>
                      </div>
                    </div>

                    <ScoreBar
                      value={role.aiScore}
                      color={role.aiScore > 90 ? "#10b981" : role.aiScore > 80 ? "#3b82f6" : "#f59e0b"}
                    />

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {role.topSkills.map((s) => (
                          <span key={s} className="skill-tag">{s}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[#8c909f]">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {role.candidates}
                        </span>
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3 text-[#10b981]" /> {role.matched} matched
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {role.days}d
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          <Link
            href="/roles/new"
            className="mt-4 flex items-center justify-center gap-2 border border-dashed border-[#424754] rounded-xl py-3 text-sm text-[#8c909f] hover:border-[#3b82f6] hover:text-[#3b82f6] transition-all"
          >
            + Post New Role
          </Link>
        </div>

        {/* Recent Activity */}
        <div className="col-span-2 flex flex-col gap-4">
          {/* AI Insight */}
          <div
            className="nh-card p-5 nh-ai-glow"
            style={{ border: "1px solid rgba(167, 139, 250, 0.2)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-[#a78bfa]/10 border border-[#a78bfa]/30 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />
              </div>
              <span className="text-xs font-semibold text-[#a78bfa] tracking-wider uppercase">
                AI Insight
              </span>
            </div>
            <p className="text-sm text-[#c2c6d6] leading-relaxed">
              <span className="text-[#e1e2ec] font-semibold">Priya Sharma</span> has a{" "}
              <span className="text-[#10b981] font-bold">96%</span> match for the Rust
              Engineer role — highest semantic alignment with Tokio async patterns in your
              pool this quarter.
            </p>
            <div className="mt-3 pt-3 border-t border-[#424754] flex items-center justify-between">
              <span className="text-[10px] text-[#8c909f] mono">Generated 2m ago · GPT-4o</span>
              <Link
                href="/candidate/c1"
                className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline"
              >
                View <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Recent Candidates */}
          <div className="nh-card p-5 flex-1">
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-base font-semibold text-[#e1e2ec]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Recent Activity
              </h2>
              <Link
                href="/dashboard/candidates"
                className="text-xs text-[#3b82f6] flex items-center gap-1 hover:underline"
              >
                All <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="space-y-3">
              {RECENT_CANDIDATES.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.07 }}
                >
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
                          {c.ai && (
                            <Sparkles className="w-3 h-3 text-[#a78bfa] flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-[#8c909f] truncate">{c.stage}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span
                          className="text-sm font-bold"
                          style={{
                            color: c.score >= 90 ? "#10b981" : c.score >= 80 ? "#3b82f6" : "#f59e0b",
                          }}
                        >
                          {c.score}%
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hiring Velocity */}
      <div className="nh-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-base font-semibold text-[#e1e2ec] flex items-center gap-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <TrendingUp className="w-4 h-4 text-[#3b82f6]" />
            Hiring Velocity
          </h2>
          <div className="flex gap-2">
            {["7d", "30d", "90d"].map((p, i) => (
              <button
                key={p}
                className={`text-xs px-3 py-1 rounded-md transition-all ${
                  i === 1
                    ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30"
                    : "text-[#8c909f] hover:text-[#e1e2ec]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-6">
          {[
            { day: "Mon", apps: 8, matches: 3 },
            { day: "Tue", apps: 14, matches: 5 },
            { day: "Wed", apps: 11, matches: 4 },
            { day: "Thu", apps: 19, matches: 7 },
            { day: "Fri", apps: 16, matches: 6 },
            { day: "Sat", apps: 5, matches: 2 },
            { day: "Sun", apps: 3, matches: 1 },
          ].map((d, i) => {
            const maxApps = 19;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center gap-0.5" style={{ height: 80 }}>
                  <div className="flex-1 w-full flex flex-col justify-end gap-0.5">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(d.matches / maxApps) * 100}%` }}
                      transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                      className="w-full rounded-t-sm bg-[#a78bfa]/60"
                    />
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{
                        height: `${((d.apps - d.matches) / maxApps) * 100}%`,
                      }}
                      transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                      className="w-full rounded-t-sm bg-[#3b82f6]/30"
                    />
                  </div>
                </div>
                <span className="text-[10px] text-[#8c909f] mono">{d.day}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs text-[#8c909f]">
            <span className="w-3 h-2 rounded-sm bg-[#3b82f6]/30 inline-block" />
            Applications
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#8c909f]">
            <span className="w-3 h-2 rounded-sm bg-[#a78bfa]/60 inline-block" />
            AI Matches
          </div>
        </div>
      </div>
    </div>
  );
}
