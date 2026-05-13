"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  Mail,
  Phone,
  GitBranch,
  ExternalLink,
  ArrowLeft,
  Star,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageSquare,
  Clock,
  Target,
  Zap,
  Loader2,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Briefcase,
  GraduationCap,
  FolderKanban,
  Trash2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api, BASE_URL, type CandidateDetail, type KeyMoment } from "@/lib/api";

function ScoreRing({ value, color, size = 88 }: { value: number; color: string; size?: number }) {
  const r = size * 0.41;
  const c = 2 * Math.PI * r;
  const progress = c - (value / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#32353c" strokeWidth={size * 0.068} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={size * 0.068}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: progress }}
        transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2} textAnchor="middle" dy="0.35em" fontSize={size * 0.2} fontWeight="bold" fill={color}>
        {value}
      </text>
    </svg>
  );
}

function CompactScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-[#8c909f] font-medium">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>{value}<span className="text-xs text-[#8c909f] ml-0.5">%</span></span>
      </div>
      <div className="h-1.5 bg-[#32353c] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const config = {
    high: { bg: "bg-[#f43f5e]/10", text: "text-[#f43f5e]", border: "border-[#f43f5e]/30", icon: AlertCircle },
    medium: { bg: "bg-[#f59e0b]/10", text: "text-[#f59e0b]", border: "border-[#f59e0b]/30", icon: AlertTriangle },
    low: { bg: "bg-[#10b981]/10", text: "text-[#10b981]", border: "border-[#10b981]/30", icon: CheckCircle },
  }[severity] || { bg: "bg-[#8c909f]/10", text: "text-[#8c909f]", border: "border-[#8c909f]/30", icon: AlertTriangle };

  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text} border ${config.border}`}>
      <Icon className="w-3 h-3" />
      {severity}
    </span>
  );
}

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "AI Screening",
  interview: "Technical Interview",
  offer: "Offer Stage",
  hired: "Hired",
};

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"resume" | "transcript" | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisMsg, setAnalysisMsg] = useState<string | null>(null);
  const [expandedFactCheck, setExpandedFactCheck] = useState<number | null>(null);
  const [showAllKeyMoments, setShowAllKeyMoments] = useState(false);
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  const router = useRouter();

  const handleDeleteCandidate = async () => {
    if (!candidate) return;
    if (!confirm(`Permanently delete ${candidate.name}? This will remove all their data, analyses, and uploaded files.`)) return;
    setDeletingCandidate(true);
    try {
      await api.candidates.delete(candidate.id);
      router.push("/dashboard/candidates");
    } catch (err) {
      alert((err as Error).message);
      setDeletingCandidate(false);
    }
  };

  const reload = () => {
    if (!id) return;
    setLoading(true);
    api.candidates.get(id).then(setCandidate).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!id) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[#8c909f]">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading candidate…
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="p-6">
        <p className="text-[#f43f5e] text-sm">Error: {error ?? "Candidate not found"}</p>
        <Link href="/dashboard" className="text-[#3b82f6] text-sm mt-2 inline-block">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const p = candidate.resume_profile;
  const a = candidate.analysis;
  const scoreColor = candidate.ai && a
    ? a.aggregate_score >= 90 ? "#10b981" : a.aggregate_score >= 80 ? "#3b82f6" : "#f59e0b"
    : "#8c909f";

  const allSkills = p
    ? [
        ...(p.skills.programming_languages ?? []),
        ...(p.skills.frameworks ?? []),
        ...(p.skills.tools ?? []),
        ...(p.skills.databases ?? []),
      ]
    : [];

  const stageLabel = STAGE_LABELS[candidate.stage] ?? candidate.stage;

  // Count severity for summary
  const severityCounts = a?.resume_alignment?.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const visibleKeyMoments = showAllKeyMoments ? a?.key_moments : a?.key_moments?.slice(0, 4);

  return (
    <div className="min-h-screen bg-[#1a1c21] p-4 md:p-6 fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#8c909f] mb-5">
        <Link href="/dashboard" className="hover:text-[#e1e2ec] transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#e1e2ec]">{candidate.name}</span>
        <div className="ml-auto">
          <button
            onClick={handleDeleteCandidate}
            disabled={deletingCandidate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#f43f5e]/30 text-[#f43f5e] text-xs font-semibold hover:bg-[#f43f5e]/10 transition-colors disabled:opacity-40"
          >
            {deletingCandidate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {deletingCandidate ? "Deleting…" : "Delete Candidate"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT SIDEBAR */}
        <div className="lg:col-span-3 space-y-4">
          {/* Identity Card - Compact */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
            <div className="flex items-center gap-3">
              <label className="cursor-pointer group relative flex-shrink-0" title="Click to change photo">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${candidate.color}, ${candidate.color}88)` }}
                >
                  {candidate.avatar_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${BASE_URL}${candidate.avatar_path}`} alt={candidate.name} className="w-full h-full object-cover" />
                  ) : (
                    candidate.avatar
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                    <Upload className="w-3.5 h-3.5 text-white" />
                  </div>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await api.candidates.uploadAvatar(candidate.id, f);
                  reload();
                }} />
              </label>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold text-[#e1e2ec] truncate" style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>
                  {candidate.name}
                </h1>
                <p className="text-xs text-[#8c909f] truncate">
                  {p?.basics?.headline ?? candidate.role}
                </p>
              </div>
            </div>

            {/* Stage + Experience inline */}
            <div className="mt-4 flex items-center justify-between text-xs">
              <span className="px-2 py-1 rounded-md bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30 font-semibold">{stageLabel}</span>
              {p && (
                <span className="text-[#8c909f]">
                  <span className="font-semibold text-[#e1e2ec]">{p.metadata?.total_experience_years ?? "—"}</span> yrs exp
                </span>
              )}
            </div>

            {/* Contact */}
            <div className="mt-4 pt-4 border-t border-[#32353c] space-y-2">
              <a href={`mailto:${candidate.email}`} className="flex items-center gap-2 text-xs text-[#8c909f] hover:text-[#3b82f6] transition-colors">
                <Mail className="w-3.5 h-3.5" />
                <span className="truncate">{candidate.email}</span>
              </a>
              {(candidate.phone ?? p?.basics?.phone) && (
                <a href={`tel:${candidate.phone ?? p?.basics?.phone}`} className="flex items-center gap-2 text-xs text-[#8c909f] hover:text-[#10b981] transition-colors">
                  <Phone className="w-3.5 h-3.5" />
                  {candidate.phone ?? p?.basics?.phone}
                </a>
              )}
            </div>
          </motion.div>

          {/* AI Match Score - Prominent */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />
              <span className="text-xs text-[#a78bfa] font-semibold uppercase tracking-wider">AI Match Score</span>
            </div>
            <div className="flex items-center gap-4">
              <ScoreRing value={a?.aggregate_score ?? 0} color={scoreColor} size={72} />
              <div>
                <p className="text-xs text-[#8c909f]">For {candidate.role}</p>
                {a && (
                  <span className={`mt-1.5 inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                    a.aggregate_score >= 90 ? "bg-[#10b981]/10 text-[#10b981]" :
                    a.aggregate_score >= 80 ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "bg-[#f59e0b]/10 text-[#f59e0b]"
                  }`}>
                    {a.aggregate_score >= 90 ? "Exceptional" : a.aggregate_score >= 80 ? "Strong" : "Moderate"}
                  </span>
                )}
                {!a && <span className="text-[10px] text-[#424754] mt-1 block">No analysis yet</span>}
              </div>
            </div>
          </motion.div>

          {/* Files & Analysis */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
            <p className="text-xs font-semibold text-[#8c909f] uppercase tracking-wider mb-3">Files & Analysis</p>

            <div className="space-y-2">
              {/* Resume upload */}
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-dashed border-[#424754] hover:border-[#3b82f6] transition-all cursor-pointer group">
                {uploading === "resume" ? (
                  <Loader2 className="w-4 h-4 text-[#3b82f6] animate-spin flex-shrink-0" />
                ) : candidate.resume_path ? (
                  <CheckCircle2 className="w-4 h-4 text-[#10b981] flex-shrink-0" />
                ) : (
                  <Upload className="w-4 h-4 text-[#424754] group-hover:text-[#3b82f6] transition-colors flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#c2c6d6]">
                    {candidate.resume_path ? "Resume" : "Upload Resume"}
                  </p>
                  <p className="text-[10px] text-[#424754] truncate">
                    {candidate.resume_path ? candidate.resume_path.split("/").pop() : "PDF"}
                  </p>
                </div>
                <input type="file" accept=".pdf" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setUploading("resume");
                  try { await api.candidates.uploadResume(candidate.id, f); reload(); } finally { setUploading(null); }
                }} />
              </label>

              {/* Transcript upload */}
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-dashed border-[#424754] hover:border-[#a78bfa] transition-all cursor-pointer group">
                {uploading === "transcript" ? (
                  <Loader2 className="w-4 h-4 text-[#a78bfa] animate-spin flex-shrink-0" />
                ) : candidate.transcript_path ? (
                  <CheckCircle2 className="w-4 h-4 text-[#10b981] flex-shrink-0" />
                ) : (
                  <Sparkles className="w-4 h-4 text-[#424754] group-hover:text-[#a78bfa] transition-colors flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#c2c6d6]">
                    {candidate.transcript_path ? "Transcript" : "Upload Transcript"}
                  </p>
                  <p className="text-[10px] text-[#424754] truncate">
                    {candidate.transcript_path ? candidate.transcript_path.split("/").pop() : "TXT"}
                  </p>
                </div>
                <input type="file" accept=".txt" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setUploading("transcript");
                  try { await api.candidates.uploadTranscript(candidate.id, f); reload(); } finally { setUploading(null); }
                }} />
              </label>
            </div>

            {/* Run Analysis */}
            {analysisMsg && (
              <p className="text-[10px] text-center mt-2" style={{ color: analysisMsg.startsWith("✓") ? "#10b981" : "#f43f5e" }}>
                {analysisMsg}
              </p>
            )}
            <button
              disabled={analysing || !candidate.resume_path || !candidate.transcript_path}
              onClick={async () => {
                setAnalysing(true); setAnalysisMsg(null);
                try {
                  await api.candidates.triggerAnalysis(candidate.id);
                  setAnalysisMsg("✓ Analysis complete — refreshing…");
                  setTimeout(reload, 800);
                } catch (e) {
                  setAnalysisMsg((e as Error).message || "Analysis failed");
                } finally {
                  setAnalysing(false);
                }
              }}
              className="w-full mt-3 py-2 rounded-lg flex items-center justify-center gap-2 text-xs font-semibold transition-all disabled:opacity-40"
              style={{
                background: analysing ? "#272a31" : "linear-gradient(135deg,#a78bfa,#3b82f6)",
                color: "#fff",
                boxShadow: analysing ? "none" : "0 0 16px rgba(167,139,250,0.25)",
              }}
            >
              {analysing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {analysing ? "Running…" : candidate.analysis ? "Re-run Analysis" : "Run AI Analysis"}
            </button>
            {!candidate.resume_path || !candidate.transcript_path ? (
              <p className="text-[9px] text-[#424754] text-center mt-2">
                Upload both files to run analysis
              </p>
            ) : null}
          </motion.div>

          {/* Timeline - Compact */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
            <h3 className="text-xs font-semibold text-[#e1e2ec] mb-3" style={{ fontFamily: "var(--font-heading)" }}>
              Pipeline Progress
            </h3>
            <div className="flex items-center gap-1">
              {[
                { event: "Applied", icon: FileText, color: "#8c909f", active: true },
                { event: "Screening", icon: Sparkles, color: "#a78bfa", active: ["screening","interview","offer","hired"].includes(candidate.stage) },
                { event: "Interview", icon: Target, color: "#3b82f6", active: ["interview","offer","hired"].includes(candidate.stage) },
                { event: "Offer", icon: Zap, color: "#10b981", active: ["offer","hired"].includes(candidate.stage) },
                { event: "Hired", icon: MessageSquare, color: "#a78bfa", active: candidate.stage === "hired" },
              ].map((t, i, arr) => (
                <div key={i} className="flex items-center gap-1 flex-1">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 relative group"
                    style={{ background: t.active ? `${t.color}18` : "#272a31", border: `1px solid ${t.active ? t.color + "33" : "#32353c"}` }}
                  >
                    <t.icon className="w-3 h-3" style={{ color: t.active ? t.color : "#424754" }} />
                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[8px] text-[#8c909f] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                      {t.event}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`flex-1 h-0.5 rounded ${t.active && arr[i+1].active ? "bg-[#424754]" : "bg-[#32353c]"}`} />
                  )}
                </div>
              ))}
            </div>
            {candidate.days !== undefined && (
              <p className="text-[10px] text-[#8c909f] text-center mt-4">Applied {candidate.days}d ago</p>
            )}
          </motion.div>
        </div>

        {/* MAIN CONTENT */}
        <div className="lg:col-span-9 space-y-4">
          {/* AI Insight Module - Enhanced */}
          {a ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-[#22252b] rounded-xl border border-[#a78bfa]/25 p-5" style={{ boxShadow: "0 0 40px rgba(167,139,250,0.08)" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-[#a78bfa]/10 border border-[#a78bfa]/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[#a78bfa]" />
                </div>
                <span className="text-xs font-semibold text-[#a78bfa] tracking-wider uppercase">AI Insight Module</span>
              </div>

              {/* Summary */}
              <p className="text-sm text-[#c2c6d6] leading-relaxed mb-5">{a.summary}</p>

              {/* Score Bars - Inline */}
              <div className="flex gap-6 p-4 rounded-xl bg-[#272a31] border border-[#32353c]">
                <CompactScoreBar label="Technical" value={a.technical_score} color="#10b981" />
                <CompactScoreBar label="Communication" value={a.communication_score} color="#3b82f6" />
                <CompactScoreBar label="Confidence" value={a.confidence_score} color="#a78bfa" />
              </div>

              {/* Strengths / Considerations - Side by side, scrollable */}
              {(a.strengths.length > 0 || a.weaknesses.length > 0) && (
                <div className="grid grid-cols-2 gap-4 mt-5">
                  <div>
                    <p className="text-xs font-semibold text-[#10b981] mb-2 flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Strengths ({a.strengths.length})
                    </p>
                    <ScrollArea className="h-32">
                      <ul className="space-y-1.5 pr-2">
                        {(a.strengths as string[]).map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                            <span className="w-1 h-1 rounded-full bg-[#10b981] flex-shrink-0 mt-1.5" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#f59e0b] mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Considerations ({a.weaknesses.length})
                    </p>
                    <ScrollArea className="h-32">
                      <ul className="space-y-1.5 pr-2">
                        {(a.weaknesses as string[]).map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-[#c2c6d6]">
                            <span className="w-1 h-1 rounded-full bg-[#f59e0b] flex-shrink-0 mt-1.5" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-[#22252b] rounded-xl border border-dashed border-[#424754] p-8 text-center">
              <Sparkles className="w-8 h-8 text-[#424754] mx-auto mb-3" />
              <p className="text-sm text-[#8c909f]">No AI analysis yet. Upload resume + transcript and run analysis.</p>
            </motion.div>
          )}

          {/* Key Moments & Resume Alignment - Tabbed */}
          {a && (a.key_moments?.length > 0 || a.resume_alignment?.length > 0) && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
              <Tabs defaultValue="key-moments" className="w-full">
                <TabsList className="bg-[#272a31] border border-[#32353c] p-1 mb-4">
                  <TabsTrigger value="key-moments" className="data-[state=active]:bg-[#3b82f6]/10 data-[state=active]:text-[#3b82f6] text-[#8c909f] text-xs">
                    <Clock className="w-3.5 h-3.5 mr-1.5" />
                    Key Moments ({a.key_moments?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="fact-check" className="data-[state=active]:bg-[#a78bfa]/10 data-[state=active]:text-[#a78bfa] text-[#8c909f] text-xs">
                    <Target className="w-3.5 h-3.5 mr-1.5" />
                    Fact Check ({a.resume_alignment?.length || 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="key-moments">
                  {a.key_moments && a.key_moments.length > 0 && (
                    <div>
                      <ul className="space-y-2">
                        {visibleKeyMoments?.map((km, i) => {
                          const isObj = typeof km === "object" && km !== null;
                          const momentText = isObj ? (km as KeyMoment).moment : (km as string);
                          const signalText = isObj ? (km as KeyMoment).signal : null;
                          return (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-[#c2c6d6] p-2.5 rounded-lg bg-[#272a31] border border-[#32353c]">
                              <span className="w-5 h-5 rounded bg-[#3b82f6]/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-[#3b82f6]">{i + 1}</span>
                              <span className="leading-relaxed flex-1">
                                {momentText}
                                {signalText && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20 align-middle">{signalText}</span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {a.key_moments.length > 4 && (
                        <button
                          onClick={() => setShowAllKeyMoments(!showAllKeyMoments)}
                          className="mt-3 w-full py-2 text-xs text-[#8c909f] hover:text-[#e1e2ec] flex items-center justify-center gap-1 transition-colors"
                        >
                          {showAllKeyMoments ? (
                            <>Show less <ChevronUp className="w-3.5 h-3.5" /></>
                          ) : (
                            <>Show {a.key_moments.length - 4} more <ChevronDown className="w-3.5 h-3.5" /></>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="fact-check">
                  {a.resume_alignment && a.resume_alignment.length > 0 && (
                    <div>
                      {/* Severity Summary */}
                      <div className="flex items-center gap-3 mb-4 text-xs">
                        {severityCounts.high > 0 && (
                          <span className="flex items-center gap-1 text-[#f43f5e]">
                            <AlertCircle className="w-3.5 h-3.5" /> {severityCounts.high} high
                          </span>
                        )}
                        {severityCounts.medium > 0 && (
                          <span className="flex items-center gap-1 text-[#f59e0b]">
                            <AlertTriangle className="w-3.5 h-3.5" /> {severityCounts.medium} medium
                          </span>
                        )}
                        {severityCounts.low > 0 && (
                          <span className="flex items-center gap-1 text-[#10b981]">
                            <CheckCircle className="w-3.5 h-3.5" /> {severityCounts.low} low
                          </span>
                        )}
                      </div>

                      {/* Collapsible Items */}
                      <ScrollArea className="h-[300px]">
                        <div className="space-y-2 pr-2">
                          {a.resume_alignment.map((item, i) => (
                            <Collapsible key={i} open={expandedFactCheck === i} onOpenChange={(open) => setExpandedFactCheck(open ? i : null)}>
                              <CollapsibleTrigger className="w-full">
                                <div className={`flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${
                                  expandedFactCheck === i 
                                    ? "bg-[#272a31] border-[#424754]" 
                                    : "bg-[#272a31]/50 border-[#32353c] hover:border-[#424754]"
                                }`}>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[#e1e2ec] leading-relaxed line-clamp-2">&ldquo;{item.claim}&rdquo;</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <SeverityBadge severity={item.severity} />
                                    <ChevronDown className={`w-4 h-4 text-[#8c909f] transition-transform ${expandedFactCheck === i ? "rotate-180" : ""}`} />
                                  </div>
                                </div>
                              </CollapsibleTrigger>
                              <AnimatePresence>
                                <CollapsibleContent>
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="px-3 pb-3"
                                  >
                                    <div className="pt-2 border-t border-[#32353c] mt-2">
                                      <p className="text-xs text-[#8c909f] leading-relaxed">{item.result}</p>
                                    </div>
                                  </motion.div>
                                </CollapsibleContent>
                              </AnimatePresence>
                            </Collapsible>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </motion.div>
          )}

          {/* Profile Details - Tabbed */}
          {p && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-[#22252b] rounded-xl border border-[#32353c] p-5">
              <Tabs defaultValue="experience" className="w-full">
                <TabsList className="bg-[#272a31] border border-[#32353c] p-1 mb-4">
                  {p.experience.length > 0 && (
                    <TabsTrigger value="experience" className="data-[state=active]:bg-[#3b82f6]/10 data-[state=active]:text-[#3b82f6] text-[#8c909f] text-xs">
                      <Briefcase className="w-3.5 h-3.5 mr-1.5" />
                      Experience ({p.experience.length})
                    </TabsTrigger>
                  )}
                  {p.education.length > 0 && (
                    <TabsTrigger value="education" className="data-[state=active]:bg-[#10b981]/10 data-[state=active]:text-[#10b981] text-[#8c909f] text-xs">
                      <GraduationCap className="w-3.5 h-3.5 mr-1.5" />
                      Education ({p.education.length})
                    </TabsTrigger>
                  )}
                  {p.projects.length > 0 && (
                    <TabsTrigger value="projects" className="data-[state=active]:bg-[#a78bfa]/10 data-[state=active]:text-[#a78bfa] text-[#8c909f] text-xs">
                      <FolderKanban className="w-3.5 h-3.5 mr-1.5" />
                      Projects ({p.projects.length})
                    </TabsTrigger>
                  )}
                  {allSkills.length > 0 && (
                    <TabsTrigger value="skills" className="data-[state=active]:bg-[#f59e0b]/10 data-[state=active]:text-[#f59e0b] text-[#8c909f] text-xs">
                      <Zap className="w-3.5 h-3.5 mr-1.5" />
                      Skills ({allSkills.length})
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* Experience */}
                <TabsContent value="experience">
                  {p.summary && (
                    <p className="text-sm text-[#c2c6d6] leading-relaxed mb-4 p-3 rounded-lg bg-[#272a31] border border-[#32353c]">{p.summary}</p>
                  )}
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-3 pr-2">
                      {p.experience.map((w, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[#272a31] border border-[#32353c]">
                          <div className="w-9 h-9 rounded-lg bg-[#32353c] flex items-center justify-center text-xs font-bold text-[#8c909f] flex-shrink-0">
                            {w.company[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-[#e1e2ec]">{w.designation}</p>
                                <p className="text-xs text-[#8c909f]">{w.company}</p>
                              </div>
                              <span className="text-[10px] font-mono text-[#8c909f] whitespace-nowrap bg-[#1a1c21] px-2 py-0.5 rounded">
                                {w.start_date} – {w.is_current ? "Present" : w.end_date}
                              </span>
                            </div>
                            {w.technologies.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {w.technologies.slice(0, 5).map((t) => (
                                  <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20">{t}</span>
                                ))}
                                {w.technologies.length > 5 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#32353c] text-[#8c909f]">+{w.technologies.length - 5}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Education */}
                <TabsContent value="education">
                  <div className="space-y-3">
                    {p.education.map((ed, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[#272a31] border border-[#32353c]">
                        <div className="w-9 h-9 rounded-lg bg-[#10b981]/10 flex items-center justify-center flex-shrink-0">
                          <Star className="w-4 h-4 text-[#10b981]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#e1e2ec]">{ed.degree} · {ed.field_of_study}</p>
                          <p className="text-xs text-[#8c909f]">{ed.institution}</p>
                        </div>
                        <span className="text-[10px] font-mono text-[#8c909f] bg-[#1a1c21] px-2 py-0.5 rounded flex-shrink-0">
                          {ed.start_date}–{ed.end_date}
                        </span>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* Projects */}
                <TabsContent value="projects">
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-3 pr-2">
                      {p.projects.map((proj, i) => (
                        <div key={i} className="p-3 rounded-lg bg-[#272a31] border border-[#32353c]">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <p className="text-sm font-semibold text-[#e1e2ec]">{proj.name}</p>
                            <div className="flex gap-1.5 flex-shrink-0">
                              {proj.github && (
                                <a href={proj.github} target="_blank" rel="noreferrer" className="w-6 h-6 rounded bg-[#32353c] flex items-center justify-center text-[#8c909f] hover:text-[#e1e2ec] transition-colors">
                                  <GitBranch className="w-3 h-3" />
                                </a>
                              )}
                              {proj.live_link && (
                                <a href={proj.live_link} target="_blank" rel="noreferrer" className="w-6 h-6 rounded bg-[#32353c] flex items-center justify-center text-[#8c909f] hover:text-[#3b82f6] transition-colors">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-[#8c909f] leading-relaxed">{proj.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {proj.technologies.slice(0, 5).map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20">{t}</span>
                            ))}
                            {proj.technologies.length > 5 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#32353c] text-[#8c909f]">+{proj.technologies.length - 5}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Skills */}
                <TabsContent value="skills">
                  <div className="space-y-4">
                    {p.skills.programming_languages && p.skills.programming_languages.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#8c909f] mb-2">Languages</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.skills.programming_languages.map((s) => (
                            <span key={s} className="px-2 py-1 rounded-md text-xs bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.skills.frameworks && p.skills.frameworks.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#8c909f] mb-2">Frameworks</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.skills.frameworks.map((s) => (
                            <span key={s} className="px-2 py-1 rounded-md text-xs bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.skills.tools && p.skills.tools.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#8c909f] mb-2">Tools</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.skills.tools.map((s) => (
                            <span key={s} className="px-2 py-1 rounded-md text-xs bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.skills.databases && p.skills.databases.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#8c909f] mb-2">Databases</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.skills.databases.map((s) => (
                            <span key={s} className="px-2 py-1 rounded-md text-xs bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
