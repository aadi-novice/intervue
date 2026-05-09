"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Sparkles, Upload, ExternalLink, GitBranch } from "lucide-react";

export default function AddCandidatePage() {
  return (
    <div className="p-6 fade-in max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#8c909f] mb-6">
        <Link href="/dashboard" className="hover:text-[#e1e2ec] transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#e1e2ec]">Add Candidate</span>
      </div>

      <div className="mb-6">
        <h1
          className="text-2xl font-semibold text-[#e1e2ec]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
        >
          Add Candidate
        </h1>
        <p className="text-[#8c909f] text-sm mt-1">
          AI will analyze and score the candidate instantly upon submission.
        </p>
      </div>

      <div className="space-y-5">
        {/* Import options */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Import From
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <button className="flex flex-col items-center gap-2 p-4 rounded-xl bg-[#272a31] border border-[#424754] hover:border-[#0077b5] group transition-all">
              <ExternalLink className="w-6 h-6 text-[#8c909f] group-hover:text-[#0077b5] transition-colors" />
              <span className="text-xs text-[#8c909f] group-hover:text-[#e1e2ec] transition-colors">LinkedIn</span>
            </button>
            <button className="flex flex-col items-center gap-2 p-4 rounded-xl bg-[#272a31] border border-[#424754] hover:border-[#e1e2ec] group transition-all">
              <GitBranch className="w-6 h-6 text-[#8c909f] group-hover:text-[#e1e2ec] transition-colors" />
              <span className="text-xs text-[#8c909f] group-hover:text-[#e1e2ec] transition-colors">GitHub</span>
            </button>
            <button className="flex flex-col items-center gap-2 p-4 rounded-xl bg-[#272a31] border-2 border-dashed border-[#424754] hover:border-[#3b82f6] group transition-all">
              <Upload className="w-6 h-6 text-[#8c909f] group-hover:text-[#3b82f6] transition-colors" />
              <span className="text-xs text-[#8c909f] group-hover:text-[#3b82f6] transition-colors">Upload CV</span>
            </button>
          </div>
        </motion.div>

        {/* Personal Info */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Personal Information
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">First Name *</label>
                <input
                  type="text"
                  placeholder="Priya"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Last Name *</label>
                <input
                  type="text"
                  placeholder="Sharma"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Email *</label>
                <input
                  type="email"
                  placeholder="priya@email.com"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Phone</label>
                <input
                  type="tel"
                  placeholder="+1 (415) 555-0192"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Location</label>
              <input
                type="text"
                placeholder="San Francisco, CA"
                className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
              />
            </div>
          </div>
        </motion.div>

        {/* Role Assignment */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Role & Stage Assignment
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Applying For *</label>
              <select className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none">
                <option>Senior Rust Engineer</option>
                <option>Lead Product Designer</option>
                <option>Data Scientist, ML Ops</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Initial Stage</label>
              <select className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none">
                <option>Applied</option>
                <option>AI Screening</option>
                <option>HR Screen</option>
                <option>Technical Interview</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* Notes */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="nh-card p-6">
          <h2
            className="text-sm font-semibold text-[#e1e2ec] mb-5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Recruiter Notes
          </h2>
          <textarea
            rows={4}
            placeholder="Add any initial context or sourcing notes..."
            className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all resize-none"
          />
        </motion.div>

        {/* AI notice */}
        <div
          className="flex items-start gap-3 p-4 rounded-xl border"
          style={{ background: "rgba(167, 139, 250, 0.05)", borderColor: "rgba(167, 139, 250, 0.2)" }}
        >
          <Sparkles className="w-4 h-4 text-[#a78bfa] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#c2c6d6] leading-relaxed">
            <span className="font-semibold text-[#a78bfa]">AI Screening will run automatically.</span> The system will
            generate a match score, extract skills from the CV, and surface key insights within seconds of submission.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Link
            href="/dashboard"
            className="px-6 py-3 rounded-xl bg-[#272a31] border border-[#424754] text-sm text-[#8c909f] hover:text-[#e1e2ec] transition-colors font-semibold"
          >
            Cancel
          </Link>
          <button className="px-6 py-3 rounded-xl bg-[#3b82f6] text-white text-sm font-semibold hover:bg-[#2563eb] transition-colors nh-action-glow flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Add & Run AI Screening
          </button>
        </div>
      </div>
    </div>
  );
}
