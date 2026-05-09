import { create } from "zustand";

export type StageId = "applied" | "screening" | "interview" | "offer" | "hired";

export interface Candidate {
  id: string;
  name: string;
  role: string;
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

const INITIAL_CANDIDATES: Candidate[] = [
  { id: "rk",  name: "Ravi Kapoor",      role: "Rust Engineer",      score: 71, avatar: "RK", color: "#8c909f", days: 1,  ai: false, stage: "applied"   },
  { id: "lm",  name: "Lena Müller",      role: "Rust Engineer",      score: 68, avatar: "LM", color: "#8c909f", days: 2,  ai: false, stage: "applied"   },
  { id: "oh",  name: "Omar Hassan",      role: "ML Ops",             score: 74, avatar: "OH", color: "#8c909f", days: 0,  ai: true,  stage: "applied"   },
  { id: "yt",  name: "Yuki Tanaka",      role: "ML Ops",             score: 93, avatar: "YT", color: "#10b981", days: 3,  ai: true,  stage: "screening" },
  { id: "an",  name: "Asel Nurlanovna",  role: "Rust Engineer",      score: 81, avatar: "AN", color: "#f59e0b", days: 4,  ai: false, stage: "screening" },
  { id: "dc",  name: "David Chen",       role: "Product Designer",   score: 79, avatar: "DC", color: "#3b82f6", days: 2,  ai: true,  stage: "screening" },
  { id: "ps",  name: "Priya Sharma",     role: "Rust Engineer",      score: 96, avatar: "PS", color: "#3b82f6", days: 7,  ai: true,  stage: "interview" },
  { id: "mw",  name: "Marcus Webb",      role: "Product Designer",   score: 89, avatar: "MW", color: "#a78bfa", days: 8,  ai: false, stage: "interview" },
  { id: "sr",  name: "Sofia Reyes",      role: "ML Ops",             score: 92, avatar: "SR", color: "#10b981", days: 15, ai: true,  stage: "offer"     },
  { id: "jp",  name: "Jin Park",         role: "Rust Engineer",      score: 98, avatar: "JP", color: "#a78bfa", days: 21, ai: true,  stage: "hired"     },
];

interface PipelineState {
  candidates: Candidate[];
  moveCandidate: (candidateId: string, toStage: StageId) => void;
  getStageCount: (stageId: StageId) => number;
  getCandidatesByStage: (stageId: StageId) => Candidate[];
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  candidates: INITIAL_CANDIDATES,

  moveCandidate: (candidateId, toStage) =>
    set((state) => ({
      candidates: state.candidates.map((c) =>
        c.id === candidateId ? { ...c, stage: toStage } : c
      ),
    })),

  getStageCount: (stageId) =>
    get().candidates.filter((c) => c.stage === stageId).length,

  getCandidatesByStage: (stageId) =>
    get().candidates.filter((c) => c.stage === stageId),
}));
