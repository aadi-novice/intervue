"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Sparkles, Plus, X } from "lucide-react";
import { useState } from "react";

const SKILL_SUGGESTIONS = ["Rust", "Go", "TypeScript", "Python", "gRPC", "K8s", "AWS", "WebAssembly", "Tokio", "React"];

export default function NewRolePage() {
  const [skills, setSkills] = useState<string[]>(["Rust", "gRPC"]);
  const [skillInput, setSkillInput] = useState("");

  const addSkill = (s: string) => {
    if (s && !skills.includes(s)) setSkills([...skills, s]);
    setSkillInput("");
  };

  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

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
        <h1
          className="text-2xl font-semibold text-[#e1e2ec]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
        >
          Post New Role
        </h1>
        <p className="text-[#8c909f] text-sm mt-1">
          AI will begin sourcing and screening candidates immediately.
        </p>
      </div>

      <div className="space-y-5">
        {/* Role Details */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Role Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">
                Job Title *
              </label>
              <input
                type="text"
                placeholder="e.g. Senior Rust Engineer"
                className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]/30 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">
                  Department *
                </label>
                <select className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none">
                  <option>Platform & Infrastructure</option>
                  <option>AI & Research</option>
                  <option>Design</option>
                  <option>Product</option>
                  <option>Engineering</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">
                  Seniority Level
                </label>
                <select className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none">
                  <option>Junior</option>
                  <option>Mid-Level</option>
                  <option selected>Senior</option>
                  <option>Staff</option>
                  <option>Principal</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">
                  Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Remote / San Francisco"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">
                  Salary Range (USD)
                </label>
                <input
                  type="text"
                  placeholder="e.g. $160k–$220k"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Job Description */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Job Description
          </h2>
          <textarea
            rows={6}
            placeholder="Describe the role, responsibilities, and what success looks like..."
            className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]/30 transition-all resize-none"
          />
          <button
            className="mt-2 flex items-center gap-2 text-xs text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-generate with AI
          </button>
        </motion.div>

        {/* Required Skills */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Required Skills
          </h2>

          <div className="flex flex-wrap gap-2 mb-4">
            {skills.map((s) => (
              <div
                key={s}
                className="skill-tag flex items-center gap-1.5 pr-2"
              >
                {s}
                <button onClick={() => removeSkill(s)} className="text-[#8c909f] hover:text-[#f43f5e] transition-colors">
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
              onKeyDown={(e) => e.key === "Enter" && addSkill(skillInput)}
              placeholder="Add skill..."
              className="flex-1 bg-[#272a31] border border-[#424754] rounded-xl px-4 py-2.5 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
            />
            <button
              onClick={() => addSkill(skillInput)}
              className="px-4 py-2.5 rounded-xl bg-[#272a31] border border-[#424754] text-[#8c909f] hover:text-[#e1e2ec] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4">
            <p className="text-xs text-[#8c909f] mb-2">AI Suggestions</p>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_SUGGESTIONS.filter((s) => !skills.includes(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => addSkill(s)}
                  className="skill-tag hover:border-[#3b82f6] hover:text-[#3b82f6] transition-colors cursor-pointer"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* AI Screening Config */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="nh-card p-6 nh-ai-glow"
          style={{ border: "1px solid rgba(167, 139, 250, 0.2)" }}
        >
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-4 h-4 text-[#a78bfa]" />
            <h2
              className="text-sm font-semibold text-[#e1e2ec]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              AI Screening Configuration
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-xs mono text-[#8c909f] uppercase tracking-wider">
                  Min. Match Threshold
                </label>
                <span className="text-xs font-bold text-[#a78bfa]">75%</span>
              </div>
              <input type="range" min={50} max={99} defaultValue={75} className="w-full accent-[#a78bfa]" />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-xs mono text-[#8c909f] uppercase tracking-wider">
                  Technical Weight
                </label>
                <span className="text-xs font-bold text-[#a78bfa]">60%</span>
              </div>
              <input type="range" min={20} max={80} defaultValue={60} className="w-full accent-[#a78bfa]" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#c2c6d6] font-semibold">Auto-schedule interviews</p>
                <p className="text-xs text-[#8c909f]">For candidates exceeding threshold</p>
              </div>
              <button className="w-12 h-6 rounded-full bg-[#a78bfa] relative transition-colors">
                <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Link
            href="/dashboard"
            className="px-6 py-3 rounded-xl bg-[#272a31] border border-[#424754] text-sm text-[#8c909f] hover:text-[#e1e2ec] transition-colors font-semibold"
          >
            Cancel
          </Link>
          <button className="px-6 py-3 rounded-xl bg-[#3b82f6] text-white text-sm font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow">
            Post Role & Start AI Sourcing
          </button>
        </div>
      </div>
    </div>
  );
}
