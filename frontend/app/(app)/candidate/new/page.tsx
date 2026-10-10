"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Sparkles, Upload, Loader2, ImageIcon } from "lucide-react";
import { api, type Role } from "@/lib/api";

export default function AddCandidatePage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState<number | "">("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.roles.list().then((r) => {
      setRoles(r);
      if (r.length > 0) setRoleId(r[0].id);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !email || !roleId) {
      setError("Name, email and role are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const candidate = await api.candidates.create({
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone: phone || undefined,
        role_id: roleId as number,
      });
      if (resumeFile) await api.candidates.uploadResume(candidate.id, resumeFile);
      if (transcriptFile) await api.candidates.uploadTranscript(candidate.id, transcriptFile);
      if (avatarFile) await api.candidates.uploadAvatar(candidate.id, avatarFile);
      router.push("/dashboard/candidates");
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
        <span className="text-[#e1e2ec]">Add Candidate</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#e1e2ec]" style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>
          Add Candidate
        </h1>
        <p className="text-[#8c909f] text-sm mt-1">AI will analyze and score the candidate upon submission.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Personal Info */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="nh-card p-6">
          <h2 className="text-sm font-semibold text-[#e1e2ec] mb-5" style={{ fontFamily: "var(--font-heading)" }}>
            Personal Information
          </h2>
          <div className="space-y-4">
            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <label className="cursor-pointer group relative">
                <div className="w-16 h-16 rounded-full border-2 border-dashed border-[#424754] group-hover:border-[#3b82f6] transition-all flex items-center justify-center overflow-hidden bg-[#272a31]">
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                  ) : firstName ? (
                    <span className="text-xl font-bold text-[#3b82f6]">
                      {`${firstName[0]}${lastName[0] ?? ""}`.toUpperCase()}
                    </span>
                  ) : (
                    <ImageIcon className="w-6 h-6 text-[#424754] group-hover:text-[#3b82f6] transition-colors" />
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setAvatarFile(f);
                    if (f) setAvatarPreview(URL.createObjectURL(f));
                    else setAvatarPreview(null);
                  }}
                />
              </label>
              <div>
                <p className="text-xs font-semibold text-[#c2c6d6]">Photo <span className="text-[#424754] font-normal">(optional)</span></p>
                <p className="text-[10px] text-[#424754] mt-0.5">JPG, PNG or WebP · max 5MB</p>
                {avatarFile && (
                  <button type="button" onClick={() => { setAvatarFile(null); setAvatarPreview(null); }} className="text-[10px] text-[#f43f5e] mt-1">Remove</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">First Name *</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="Priya"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Last Name</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="priya@email.com"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] placeholder-[#424754] outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Role Assignment */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="nh-card p-6">
          <h2 className="text-sm font-semibold text-[#e1e2ec] mb-5" style={{ fontFamily: "var(--font-heading)" }}>
            Role Assignment
          </h2>
          <div>
            <label className="block text-xs mono text-[#8c909f] mb-1.5 uppercase tracking-wider">Applying For *</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(Number(e.target.value))}
              required
              className="w-full bg-[#272a31] border border-[#424754] rounded-xl px-4 py-3 text-sm text-[#e1e2ec] outline-none focus:border-[#3b82f6] transition-all appearance-none"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
              {roles.length === 0 && <option disabled>Loading roles…</option>}
            </select>
          </div>
        </motion.div>

        {/* File Uploads */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="nh-card p-6">
          <h2 className="text-sm font-semibold text-[#e1e2ec] mb-5" style={{ fontFamily: "var(--font-heading)" }}>
            Documents <span className="text-[#424754] font-normal">(optional)</span>
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Resume */}
            <div>
              <p className="text-xs mono text-[#8c909f] mb-2 uppercase tracking-wider">Resume (PDF)</p>
              <label className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-dashed border-[#424754] hover:border-[#3b82f6] transition-all cursor-pointer group">
                <Upload className="w-5 h-5 text-[#8c909f] group-hover:text-[#3b82f6] transition-colors" />
                <span className="text-xs text-[#8c909f] group-hover:text-[#e1e2ec] transition-colors text-center">
                  {resumeFile ? resumeFile.name : "Click to upload"}
                </span>
                <input type="file" accept=".pdf" className="hidden" onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {/* Transcript */}
            <div>
              <p className="text-xs mono text-[#8c909f] mb-2 uppercase tracking-wider">Interview Transcript (TXT)</p>
              <label className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-dashed border-[#424754] hover:border-[#a78bfa] transition-all cursor-pointer group">
                <Sparkles className="w-5 h-5 text-[#8c909f] group-hover:text-[#a78bfa] transition-colors" />
                <span className="text-xs text-[#8c909f] group-hover:text-[#e1e2ec] transition-colors text-center">
                  {transcriptFile ? transcriptFile.name : "Click to upload"}
                </span>
                <input type="file" accept=".txt" className="hidden" onChange={(e) => setTranscriptFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
        </motion.div>

        {/* AI notice */}
        <div
          className="flex items-start gap-3 p-4 rounded-xl border"
          style={{ background: "rgba(167, 139, 250, 0.05)", borderColor: "rgba(167, 139, 250, 0.2)" }}
        >
          <Sparkles className="w-4 h-4 text-[#a78bfa] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#c2c6d6] leading-relaxed">
            <span className="font-semibold text-[#a78bfa]">AI Screening runs automatically</span> once both resume and transcript are uploaded. You can also upload them later from the candidate profile.
          </p>
        </div>

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
            {submitting ? "Creating…" : "Add Candidate"}
          </button>
        </div>
      </form>
    </div>
  );
}
