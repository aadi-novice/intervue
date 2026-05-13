import { create } from "zustand";
import { api, type PipelineCandidate } from "./api";

export type StageId = "applied" | "screening" | "interview" | "offer" | "hired";

export interface Candidate {
  id: string;
  name: string;
  role: string;
  role_id: number;
  score: number;
  avatar: string;
  color: string;
  days: number;
  ai: boolean;
  stage: StageId;
}

export interface Stage {
  id: StageId;
  label: string;
  color: string;
}

export const STAGES: Stage[] = [
  { id: "applied",   label: "Applied",            color: "#8c909f" },
  { id: "screening", label: "AI Screening",        color: "#f59e0b" },
  { id: "interview", label: "Technical Interview", color: "#3b82f6" },
  { id: "offer",     label: "Offer Stage",         color: "#10b981" },
  { id: "hired",     label: "Hired",               color: "#a78bfa" },
];

function toCandidate(c: PipelineCandidate): Candidate {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    role_id: c.role_id,
    score: c.score,
    avatar: c.avatar,
    color: c.color,
    days: c.days,
    ai: c.ai,
    stage: (c.stage as StageId) ?? "applied",
  };
}

interface PipelineState {
  candidates: Candidate[];
  loading: boolean;
  error: string | null;

  fetchCandidates: () => Promise<void>;
  moveCandidate: (candidateId: string, toStage: StageId) => Promise<void>;
  getStageCount: (stageId: StageId) => number;
  getCandidatesByStage: (stageId: StageId) => Candidate[];
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  candidates: [],
  loading: false,
  error: null,

  fetchCandidates: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.candidates.list();
      set({ candidates: data.map(toCandidate), loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  moveCandidate: async (candidateId, toStage) => {
    // Optimistic update — move locally first so drag feels instant
    set((state) => ({
      candidates: state.candidates.map((c) =>
        c.id === candidateId ? { ...c, stage: toStage } : c
      ),
    }));
    // Persist to backend
    try {
      await api.candidates.updateStatus(candidateId, toStage);
    } catch (e) {
      console.error("Failed to persist stage change:", e);
      // Optionally revert here
    }
  },

  getStageCount: (stageId) =>
    get().candidates.filter((c) => c.stage === stageId).length,

  getCandidatesByStage: (stageId) =>
    get().candidates.filter((c) => c.stage === stageId),
}));
