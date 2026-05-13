"use client";

import { motion } from "framer-motion";
import { Settings, Bell, Shield, Palette, Database, Zap } from "lucide-react";

const SETTINGS_SECTIONS = [
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure alerts for stage changes, new applicants, and AI insights",
    color: "#f59e0b",
  },
  {
    icon: Shield,
    title: "Security",
    description: "Manage authentication, API keys, and access control",
    color: "#3b82f6",
  },
  {
    icon: Palette,
    title: "Appearance",
    description: "Theme, density, and display preferences",
    color: "#a78bfa",
  },
  {
    icon: Database,
    title: "Data & Privacy",
    description: "Export data, retention policies, and GDPR options",
    color: "#10b981",
  },
  {
    icon: Zap,
    title: "Integrations",
    description: "Connect with ATS, Slack, Google Calendar, and more",
    color: "#f43f5e",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 fade-in">
      <div className="mb-6">
        <h1
          className="text-2xl font-semibold text-[#e1e2ec]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
        >
          Settings
        </h1>
        <p className="text-[#8c909f] text-sm mt-0.5">Configure your workspace preferences</p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-3xl">
        {SETTINGS_SECTIONS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="nh-card p-5 cursor-pointer hover:border-[#3b82f6]/40 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${s.color}18`, border: `1px solid ${s.color}30` }}
              >
                <s.icon className="w-4.5 h-4.5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#e1e2ec] group-hover:text-[#3b82f6] transition-colors">
                  {s.title}
                </p>
                <p className="text-xs text-[#8c909f] mt-0.5 leading-relaxed">{s.description}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="text-xs text-[#424754] mt-8">Settings panels coming soon.</p>
    </div>
  );
}
