"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  CandidateAvatar,
  Icon,
  KanbanColumn as KanbanColumnShell,
  LoadingRegion,
  Skeleton,
  scoreTone,
  toneBar,
  toneText,
} from "@/components/m3";
import { cn } from "@/lib/utils";
import {
  usePipelineStore,
  STAGES,
  type Candidate,
  type StageId,
} from "@/lib/pipeline-store";
import { CAN, roleAllowed, useRole } from "@/lib/roles";
import { filterPipeline } from "./pipeline-filter";

/* Card UI (pure presentational) */
function CardContent({ candidate }: { candidate: Candidate }) {
  const tone = scoreTone(candidate.score);
  return (
    <div className="state-layer select-none rounded-md bg-surface-container-high p-3 text-on-surface">
      <div className="mb-2.5 flex items-center gap-2.5">
        <CandidateAvatar name={candidate.name} initials={candidate.avatar} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="truncate label-l">{candidate.name}</p>
            {candidate.ai && <Icon name="psychology" size={14} filled className="shrink-0 text-ai" label="AI analysed" />}
          </div>
          <p className="truncate body-s text-on-surface-variant">{candidate.role}</p>
        </div>
        <Icon name="drag_indicator" size={18} className="text-outline" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 label-m text-on-surface-variant">
          <Icon name="schedule" size={14} />
          {candidate.days}d
        </div>
        <span className={cn("label-l tabular-nums", toneText[tone])}>{candidate.score > 0 ? `${candidate.score}%` : "—"}</span>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-surface-container-highest">
        <div className={cn("h-full rounded-full", toneBar[tone])} style={{ width: `${candidate.score}%` }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Sortable card — tap navigates, drag moves
───────────────────────────────────────── */
function SortableCard({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
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
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.25 : 1,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
      onClick={() => {
        // Only navigate on click (not at end of a drag)
        if (!isDragging) router.push(`/candidate/${candidate.id}`);
      }}
    >
      <CardContent candidate={candidate} />
    </div>
  );
}

/* Droppable column */
function KanbanColumn({
  stageId, label, candidates, isOver,
}: {
  stageId: StageId; label: string; candidates: Candidate[]; isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: stageId, data: { type: "COLUMN", stageId } });
  return (
    <KanbanColumnShell stage={stageId} label={label} count={candidates.length} isOver={isOver} dropRef={setNodeRef}>
      <SortableContext items={candidates.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <AnimatePresence mode="popLayout">
          {candidates.map((c) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.16 }}>
              <SortableCard candidate={c} />
            </motion.div>
          ))}
        </AnimatePresence>
      </SortableContext>
    </KanbanColumnShell>
  );
}

const customCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Kanban board of pipeline candidates. Pass `roleId` to restrict to one role.
 * Drag-and-drop updates are optimistic (store) and disabled for roles that cannot move stages.
 */
export function PipelineBoard({ roleId = null, search = "" }: { roleId?: number | null; search?: string }) {
  const candidates = usePipelineStore((s) => s.candidates);
  const moveCandidate = usePipelineStore((s) => s.moveCandidate);
  const fetchCandidates = usePipelineStore((s) => s.fetchCandidates);
  const loading = usePipelineStore((s) => s.loading);
  const error = usePipelineStore((s) => s.error);

  const role = useRole();
  const canMove = roleAllowed(role, CAN.moveStage);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<StageId | null>(null);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeCandidate = candidates.find((c) => c.id === activeId) ?? null;

  const resolveStage = (id: string | null): StageId | null => {
    if (!id) return null;
    if (STAGES.find((s) => s.id === id)) return id as StageId;
    return candidates.find((c) => c.id === id)?.stage ?? null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string);
  const handleDragOver = ({ over }: DragOverEvent) => setOverStage(resolveStage((over?.id as string) ?? null));
  const handleDragCancel = () => {
    setActiveId(null);
    setOverStage(null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    setOverStage(null);
    if (!over || !canMove) return; // interviewers are read-only
    const toStage = resolveStage(over.id as string);
    if (!toStage) return;
    const cand = candidates.find((c) => c.id === active.id);
    if (cand && cand.stage !== toStage) moveCandidate(cand.id, toStage);
  };

  const inStage = (stageId: StageId) =>
    filterPipeline(candidates, { roleId, search }).filter((c) => c.stage === stageId);

  if (loading && candidates.length === 0) {
    return (
      <LoadingRegion label="Loading candidates" className="flex h-full gap-3 overflow-hidden">
        {STAGES.map((st) => (
          <Skeleton key={st.id} className="h-full w-[260px] shrink-0 rounded-lg" />
        ))}
      </LoadingRegion>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {error && (
        <p role="alert" className="body-m text-error">
          {error}
        </p>
      )}
      {!canMove && <p className="label-m text-on-surface-variant">Your role can view the pipeline but not move candidates.</p>}
      <DndContext
        sensors={canMove ? sensors : []}
        collisionDetection={customCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stageId={stage.id}
              label={stage.label}
              candidates={inStage(stage.id)}
              isOver={overStage === stage.id}
            />
          ))}
        </div>

        <DragOverlay adjustScale={false} dropAnimation={{ duration: 160, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeCandidate ? (
            <div className="w-[240px] rotate-1 rounded-md elevation-4" style={{ pointerEvents: "none" }}>
              <CardContent candidate={activeCandidate} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
