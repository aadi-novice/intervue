"use client";

import { useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { Sparkles, Clock, Search, Filter, GripVertical, Plus } from "lucide-react";
import {
  usePipelineStore,
  STAGES,
  type Candidate,
  type StageId,
} from "@/lib/pipeline-store";

/* ─────────────────────────────────────────
   Card UI (pure presentational)
───────────────────────────────────────── */
function CardContent({ candidate }: { candidate: Candidate }) {
  const scoreColor =
    candidate.score >= 90 ? "#10b981" : candidate.score >= 80 ? "#3b82f6" : "#f59e0b";

  return (
    <div className="kanban-card select-none">
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${candidate.color}, ${candidate.color}88)`,
          }}
        >
          {candidate.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-[13px] font-semibold text-[#e1e2ec] truncate">
              {candidate.name}
            </p>
            {candidate.ai && (
              <Sparkles className="w-3 h-3 text-[#a78bfa] flex-shrink-0" />
            )}
          </div>
          <p className="text-[11px] text-[#8c909f] truncate">{candidate.role}</p>
        </div>
        <GripVertical className="w-3.5 h-3.5 text-[#32353c] flex-shrink-0" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[11px] text-[#8c909f]">
          <Clock className="w-3 h-3" />
          {candidate.days}d
        </div>
        <span className="text-[13px] font-bold" style={{ color: scoreColor }}>
          {candidate.score}%
        </span>
      </div>
      <div className="mt-2 h-0.5 bg-[#32353c] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${candidate.score}%`, backgroundColor: scoreColor }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Sortable card wrapper
───────────────────────────────────────── */
function SortableCard({ candidate }: { candidate: Candidate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: candidate.id,
    data: { type: "CARD", candidate, stageId: candidate.stage },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform), // Translate only — no scale distortion
        transition,
        opacity: isDragging ? 0.25 : 1,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
    >
      <CardContent candidate={candidate} />
    </div>
  );
}

/* ─────────────────────────────────────────
   Droppable column
───────────────────────────────────────── */
function KanbanColumn({
  stageId,
  label,
  color,
  candidates,
  isOver,
}: {
  stageId: StageId;
  label: string;
  color: string;
  candidates: Candidate[];
  isOver: boolean;
}) {
  // The ENTIRE column body is the droppable target — fixes empty-column drops
  const { setNodeRef } = useDroppable({
    id: stageId,
    data: { type: "COLUMN", stageId },
  });

  return (
    <div
      className="flex flex-col flex-shrink-0 rounded-xl border transition-colors duration-150"
      style={{
        width: 220,
        minHeight: 0,
        backgroundColor: "#1d2027",
        borderColor: isOver ? `${color}55` : "#424754",
        boxShadow: isOver ? `0 0 0 1px ${color}33` : "none",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 flex-shrink-0 border-b"
        style={{ borderColor: "#424754" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-[12px] font-semibold text-[#c2c6d6] whitespace-nowrap">
            {label}
          </span>
        </div>
        <span
          className="text-[11px] font-mono text-[#8c909f] px-1.5 py-0.5 rounded"
          style={{ backgroundColor: "#272a31" }}
        >
          {candidates.length}
        </span>
      </div>

      {/* Drop zone — full height, always registered */}
      <div
        ref={setNodeRef}
        className="flex-1 p-2.5 flex flex-col gap-2 overflow-y-auto"
        style={{ minHeight: 180 }}
      >
        <SortableContext
          items={candidates.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <AnimatePresence mode="popLayout">
            {candidates.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.16 }}
              >
                <SortableCard candidate={c} />
              </motion.div>
            ))}
          </AnimatePresence>
        </SortableContext>

        {/* Empty state — still inside the droppable div */}
        {candidates.length === 0 && (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed"
            style={{
              minHeight: 120,
              borderColor: isOver ? `${color}66` : "#32353c",
              backgroundColor: isOver ? `${color}08` : "transparent",
              transition: "all 0.15s ease",
            }}
          >
            <Plus
              className="w-4 h-4"
              style={{ color: isOver ? color : "#424754" }}
            />
            <p
              className="text-[11px] font-medium"
              style={{ color: isOver ? color : "#424754" }}
            >
              {isOver ? "Release to drop" : "Empty stage"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Custom collision detection:
   pointerWithin first (so empty columns work),
   fall back to rectIntersection
───────────────────────────────────────── */
const customCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return rectIntersection(args);
};

/* ─────────────────────────────────────────
   Pipeline Page
───────────────────────────────────────── */
export default function PipelinePage() {
  const candidates = usePipelineStore((s) => s.candidates);
  const moveCandidate = usePipelineStore((s) => s.moveCandidate);
  const getCandidatesByStage = usePipelineStore((s) => s.getCandidatesByStage);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<StageId | null>(null);
  const [filterRole, setFilterRole] = useState("All Roles");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // require 8px movement before drag starts
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeCandidate = candidates.find((c) => c.id === activeId) ?? null;

  // Resolve which stage an id belongs to (either a stageId or a candidateId)
  const resolveStage = (id: string | null): StageId | null => {
    if (!id) return null;
    if (STAGES.find((s) => s.id === id)) return id as StageId;
    return candidates.find((c) => c.id === id)?.stage ?? null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    setOverStage(resolveStage((over?.id as string) ?? null));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    setOverStage(null);

    if (!over) return;
    const toStage = resolveStage(over.id as string);
    if (!toStage) return;

    const cand = candidates.find((c) => c.id === active.id);
    if (cand && cand.stage !== toStage) {
      moveCandidate(cand.id, toStage);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverStage(null);
  };

  const stageFilter = (stageId: StageId) => {
    const list = getCandidatesByStage(stageId);
    if (filterRole === "All Roles") return list;
    const keyword = filterRole.split(" ")[0].toLowerCase();
    return list.filter((c) => c.role.toLowerCase().includes(keyword));
  };

  const ROLE_FILTERS = ["All Roles", "Sr. Rust Engineer", "Lead Product Designer", "ML Ops"];

  return (
    <div className="flex flex-col h-full overflow-hidden p-5 gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1
            className="text-xl font-semibold text-[#e1e2ec]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
          >
            Pipeline
          </h1>
          <p className="text-[#8c909f] text-xs mt-0.5">
            Drag cards between stages · {candidates.length} total candidates
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 w-48"
            style={{ background: "#272a31", border: "1px solid #424754" }}
          >
            <Search className="w-3.5 h-3.5 text-[#8c909f] flex-shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              className="bg-transparent text-sm text-[#e1e2ec] placeholder-[#424754] outline-none w-full"
            />
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-[#8c909f] transition-colors"
            style={{ background: "#272a31", border: "1px solid #424754" }}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
        </div>
      </div>

      {/* ── Role chips ── */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {ROLE_FILTERS.map((r) => (
          <button
            key={r}
            onClick={() => setFilterRole(r)}
            className="px-3 py-1 rounded-full text-[12px] font-semibold transition-all"
            style={
              filterRole === r
                ? { background: "#3b82f6", color: "#fff" }
                : {
                    background: "#272a31",
                    border: "1px solid #424754",
                    color: "#8c909f",
                  }
            }
          >
            {r}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[#32353c] flex items-center gap-1">
          <GripVertical className="w-3 h-3" />
          Drag to move
        </span>
      </div>

      {/* ── Kanban board ── */}
      <div className="flex-1 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={customCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            className="flex gap-3 h-full overflow-x-auto pb-2"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#32353c transparent" }}
          >
            {STAGES.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stageId={stage.id}
                label={stage.label}
                color={stage.color}
                candidates={stageFilter(stage.id)}
                isOver={overStage === stage.id}
              />
            ))}
          </div>

          {/* Drag ghost — rendered at document root via portal, always tracks cursor */}
          <DragOverlay
            adjustScale={false}
            dropAnimation={{
              duration: 160,
              easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
            }}
          >
            {activeCandidate ? (
              <div
                style={{
                  width: 220,
                  transform: "rotate(1.5deg)",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.3)",
                  borderRadius: 12,
                  pointerEvents: "none",
                }}
              >
                <CardContent candidate={activeCandidate} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
