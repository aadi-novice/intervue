"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Sparkles, Plus, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

const SKILL_SUGGESTIONS = ["Rust", "Go", "TypeScript", "Python", "gRPC", "K8s", "AWS", "WebAssembly", "Tokio", "React"];
const EXPERIENCE_LEVELS = ["junior", "mid", "senior", "staff", "principal"];

export default function NewRolePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("senior");
  const [experienceYears, setExperienceYears] = useState(3);
  const [skills, setSkills] = useState<string[]>(["Rust", "gRPC"]);
  const [skillInput, setSkillInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSkill = (s: string) => {
    if (s && !skills.includes(s)) setSkills([...skills, s]);
    setSkillInput("");
  };
  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) { setError("Job title is required."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.roles.create({
        name: title,
        experience_level: experienceLevel,
        experience_required_years: experienceYears,
      });
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 fade-in max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#8c909f] mb-6">
        <Link href="/dashboard" className="hover:text-[#e1e2ec] transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#e1e2ec]">Post New Role</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>
          Post New Role
        </h1>
        <p className="text-[#8c909f] text-sm mt-1">AI will begin sourcing and screening candidates immediately.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Role Details */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="nh-card p-6">
          <h2 className="text-sm font-semibold text-[#e1e2ec] mb-5" style={{ fontFamily: "var(--font-heading)" }}>
            Role Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Job Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Senior Rust Engineer"
                className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]/30 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Seniority Level</label>
                <select
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none"
                >
                  {EXPERIENCE_LEVELS.map((l) => (
                    <option key={l} value={l} className="capitalize">{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Years Required</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(Number(e.target.value))}
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Required Skills */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="nh-card p-6">
          <h2 className="text-sm font-semibold text-[#e1e2ec] mb-5" style={{ fontFamily: "var(--font-heading)" }}>
            Required Skills
          </h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {skills.map((s) => (
              <div key={s} className="skill-tag flex items-center gap-1.5 pr-2">
                {s}
                <button type="button" onClick={() => removeSkill(s)} className="text-[#8c909f] hover:text-[#f43f5e] transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill(skillInput))}
              placeholder="Add skill…"
              className="flex-1 bg-[#272a31] border border-[#424754] rounded-xl px-4 py-2.5 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
            />
            <button type="button" onClick={() => addSkill(skillInput)} className="px-4 py-2.5 rounded-xl bg-[#272a31] border border-[#424754] text-[#8c909f] hover:text-[#e1e2ec] transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-4">
            <p className="text-xs text-[#8c909f] mb-2">Suggestions</p>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_SUGGESTIONS.filter((s) => !skills.includes(s)).map((s) => (
                <button type="button" key={s} onClick={() => addSkill(s)} className="skill-tag hover:border-[#3b82f6] hover:text-[#3b82f6] transition-colors cursor-pointer">
                  + {s}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {error && <p className="text-sm text-[#f43f5e] px-1">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Link href="/dashboard" className="px-6 py-3 rounded-xl bg-[#272a31] border border-[#424754] text-sm text-[#8c909f] hover:text-[#e1e2ec] transition-colors font-semibold">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-3 rounded-xl bg-[#3b82f6] text-white text-sm font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow flex items-center gap-2 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {submitting ? "Posting…" : "Post Role & Start AI Sourcing"}
          </button>
        </div>
      </form>
    </div>
  );
}
