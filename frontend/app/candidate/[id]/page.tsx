"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  Mail,
  Phone,
  MapPin,
  GitBranch,
  ExternalLink,
  ArrowLeft,
  Star,
  ChevronRight,
  FileText,
  MessageSquare,
  Clock,
  Target,
  Zap,
} from "lucide-react";

const CANDIDATE = {
  id: "c1",
  name: "Priya Sharma",
  title: "Senior Rust / Systems Engineer",
  location: "San Francisco, CA",
  email: "priya.sharma@email.com",
  phone: "+1 (415) 555-0192",
  score: 96,
  stage: "Technical Interview",
  role: "Senior Rust Engineer",
  avatar: "PS",
  color: "#3b82f6",
  experience: "7 years",
  education: "M.S. Computer Science · Stanford",
  summary:
    "Systems engineer with deep expertise in Rust, async runtime design, and distributed systems. Previously at Cloudflare and Figma. Open-source contributor to Tokio.",
  skills: ["Rust", "Tokio", "WebAssembly", "gRPC", "K8s", "Distributed Systems", "C++", "Go", "Linux"],
  aiInsight:
    "Priya demonstrates rare expertise in Tokio's async runtime internals — a critical requirement for your Platform team's WebAssembly gateway project. Her OSS contributions show 94th percentile code quality among candidates screened this quarter.",
  workHistory: [
    { company: "Cloudflare", role: "Staff Systems Engineer", period: "2021–2024", current: false },
    { company: "Figma", role: "Senior Engineer", period: "2018–2021", current: false },
    { company: "Mozilla", role: "Engineer", period: "2017–2018", current: false },
  ],
  timeline: [
    { event: "Applied", date: "Apr 28", icon: FileText, color: "#8c909f" },
    { event: "AI Screening Complete", date: "Apr 29", icon: Sparkles, color: "#a78bfa" },
    { event: "HR Screen", date: "May 2", icon: MessageSquare, color: "#f59e0b" },
    { event: "Technical Interview (Scheduled)", date: "May 12", icon: Target, color: "#3b82f6" },
  ],
};

function ScoreRing({ value, color }: { value: number; color: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const progress = c - (value / 100) * c;
  return (
    <svg width={88} height={88} viewBox="0 0 88 88">
      <circle cx={44} cy={44} r={r} fill="none" stroke="#32353c" strokeWidth={6} />
      <motion.circle
        cx={44}
        cy={44}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: progress }}
        transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
        transform="rotate(-90 44 44)"
      />
      <text x={44} y={44} textAnchor="middle" dy="0.35em" fontSize={18} fontWeight="bold" fill={color}>
        {value}
      </text>
    </svg>
  );
}

export default function CandidateProfilePage() {
  return (
    <div className="p-6 fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#8c909f] mb-5">
        <Link href="/dashboard" className="hover:text-[#e1e2ec] transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#e1e2ec]">{CANDIDATE.name}</span>
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* LEFT PANE — Fixed identity */}
        <div className="col-span-2 space-y-4">
          {/* Identity card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="nh-card p-6"
          >
            <div className="flex items-start gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${CANDIDATE.color}, ${CANDIDATE.color}88)` }}
              >
                {CANDIDATE.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <h1
                  className="text-xl font-bold text-[#e1e2ec]"
                  style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
                >
                  {CANDIDATE.name}
                </h1>
                <p className="text-sm text-[#8c909f] mt-0.5">{CANDIDATE.title}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <MapPin className="w-3.5 h-3.5 text-[#8c909f]" />
                  <span className="text-xs text-[#8c909f]">{CANDIDATE.location}</span>
                </div>
              </div>
            </div>

            {/* Score */}
            <div className="mt-5 p-4 rounded-xl bg-[#272a31] border border-[#424754] flex items-center gap-5">
              <ScoreRing value={CANDIDATE.score} color="#10b981" />
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />
                  <span className="text-xs text-[#a78bfa] font-semibold uppercase tracking-wider">
                    AI Match Score
                  </span>
                </div>
                <p className="text-sm text-[#c2c6d6]">For {CANDIDATE.role}</p>
                <span className="match-pill match-strong mt-2 inline-block">Exceptional</span>
              </div>
            </div>

            {/* Stage */}
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#8c909f] mb-1">Current Stage</p>
                <span className="match-pill status-interview px-3 py-1 text-xs">{CANDIDATE.stage}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#8c909f] mb-1">Experience</p>
                <p className="text-sm font-semibold text-[#e1e2ec]">{CANDIDATE.experience}</p>
              </div>
            </div>

            {/* Contact */}
            <div className="mt-5 space-y-2.5 pt-4 border-t border-[#424754]">
              <a href={`mailto:${CANDIDATE.email}`} className="flex items-center gap-2.5 text-sm text-[#8c909f] hover:text-[#3b82f6] transition-colors">
                <Mail className="w-4 h-4" />
                {CANDIDATE.email}
              </a>
              <div className="flex items-center gap-2.5 text-sm text-[#8c909f]">
                <Phone className="w-4 h-4" />
                {CANDIDATE.phone}
              </div>
              <div className="flex items-center gap-2.5 text-sm text-[#8c909f] hover:text-[#e1e2ec] transition-colors cursor-pointer">
                <GitBranch className="w-4 h-4" />
                github.com/priyasharma
              </div>
              <div className="flex items-center gap-2.5 text-sm text-[#8c909f] hover:text-[#e1e2ec] transition-colors cursor-pointer">
                <ExternalLink className="w-4 h-4" />
                linkedin.com/in/priyasharma
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="py-2.5 rounded-xl bg-[#3b82f6] text-white text-sm font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow">
                Send Offer
              </button>
              <button className="py-2.5 rounded-xl bg-[#272a31] border border-[#424754] text-[#c2c6d6] text-sm font-semibold hover:bg-[#32353c] transition-colors">
                Schedule
              </button>
            </div>
          </motion.div>

          {/* Skills */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="nh-card p-5"
          >
            <h3
              className="text-sm font-semibold text-[#e1e2ec] mb-3"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Technical Skills
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {CANDIDATE.skills.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
          </motion.div>

          {/* Timeline */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="nh-card p-5"
          >
            <h3
              className="text-sm font-semibold text-[#e1e2ec] mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Timeline
            </h3>
            <div className="space-y-3">
              {CANDIDATE.timeline.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${t.color}18`, border: `1px solid ${t.color}33` }}
                  >
                    <t.icon className="w-3 h-3" style={{ color: t.color }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[#c2c6d6]">{t.event}</p>
                  </div>
                  <span className="text-[10px] mono text-[#8c909f]">{t.date}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* RIGHT PANE — Scrolling details */}
        <div className="col-span-3 space-y-4">
          {/* AI Insight */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="nh-card p-5 nh-ai-glow"
            style={{ border: "1px solid rgba(167, 139, 250, 0.25)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-[#a78bfa]/10 border border-[#a78bfa]/30 flex items-center justify-center ai-pulse">
                <Sparkles className="w-4 h-4 text-[#a78bfa]" />
              </div>
              <span className="text-xs font-semibold text-[#a78bfa] tracking-wider uppercase">
                AI Insight Module
              </span>
              <span className="ml-auto text-[10px] mono text-[#8c909f]">GPT-4o · Confidence 97%</span>
            </div>
            <p className="text-sm text-[#c2c6d6] leading-relaxed">{CANDIDATE.aiInsight}</p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { label: "Technical Depth", val: 97, color: "#10b981" },
                { label: "Culture Fit", val: 88, color: "#3b82f6" },
                { label: "Growth Potential", val: 94, color: "#a78bfa" },
              ].map((m) => (
                <div key={m.label} className="bg-[#272a31] rounded-xl p-3 border border-[#424754]">
                  <p className="text-[10px] text-[#8c909f] mono mb-2">{m.label}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-xl font-bold" style={{ color: m.color, fontFamily: "var(--font-heading)" }}>
                      {m.val}
                    </span>
                    <span className="text-xs text-[#8c909f] mb-0.5">%</span>
                  </div>
                  <div className="mt-2 h-1 bg-[#32353c] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${m.val}%` }}
                      transition={{ delay: 0.5, duration: 0.8 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Summary */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="nh-card p-5"
          >
            <h3
              className="text-sm font-semibold text-[#e1e2ec] mb-3"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Summary
            </h3>
            <p className="text-sm text-[#c2c6d6] leading-relaxed">{CANDIDATE.summary}</p>
          </motion.div>

          {/* Work History */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="nh-card p-5"
          >
            <h3
              className="text-sm font-semibold text-[#e1e2ec] mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Work History
            </h3>
            <div className="space-y-3">
              {CANDIDATE.workHistory.map((w, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-[#272a31] border border-[#424754]">
                  <div className="w-8 h-8 rounded-lg bg-[#32353c] flex items-center justify-center text-xs font-bold text-[#8c909f]">
                    {w.company[0]}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#e1e2ec]">{w.role}</p>
                    <p className="text-xs text-[#8c909f] mt-0.5">{w.company}</p>
                  </div>
                  <span className="text-xs mono text-[#8c909f]">{w.period}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Education */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="nh-card p-5"
          >
            <h3
              className="text-sm font-semibold text-[#e1e2ec] mb-3"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Education
            </h3>
            <div className="flex items-center gap-4 p-4 rounded-xl bg-[#272a31] border border-[#424754]">
              <div className="w-8 h-8 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center">
                <Star className="w-4 h-4 text-[#3b82f6]" />
              </div>
              <p className="text-sm text-[#e1e2ec]">{CANDIDATE.education}</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
