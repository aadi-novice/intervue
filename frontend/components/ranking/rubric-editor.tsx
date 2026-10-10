"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, EmptyState, Icon, IconButton, LoadingRegion, Skeleton, Slider, Switch, TextField } from "@/components/m3";
import { useSnackbar } from "@/components/m3/snackbar";
import {
  MAX_CRITERIA,
  RUBRIC_ERROR_MESSAGES,
  apiMessage,
  normalisedWeights,
  validateRubric,
  type Criterion,
  type CriterionInput,
} from "@/lib/api-ranking";
import { ApiError } from "@/lib/api";
import { useRubric, useSaveRubric, useSuggestRubric } from "@/lib/queries/ranking";

export interface EditorItem extends CriterionInput {
  key: string;
  ai?: boolean;
}

let uid = 0;
const newKey = () => `c${++uid}`;

/** The API stores weights normalised to sum 1; show them on the 0-100 slider scale. */
export function fromServer(c: Criterion[]): EditorItem[] {
  const sum = c.reduce((a, x) => a + x.weight, 0);
  const scale = sum > 0 && sum <= 1.5 ? 100 : 1;
  return [...c]
    .sort((a, b) => a.position - b.position)
    .map((x) => ({
      key: newKey(),
      id: x.id,
      name: x.name,
      description: x.description,
      weight: Math.round(x.weight * scale),
      must_have: x.must_have,
    }));
}

/** Suggested criteria from the LLM -> editor rows (weights scaled to a 0-100 range if given as fractions). */
export function fromSuggestion(raw: Partial<CriterionInput>[]): EditorItem[] {
  const weights = raw.map((r) => Number(r.weight) || 0);
  const scale = Math.max(...weights, 0) > 0 && Math.max(...weights) <= 1 ? 100 : 1;
  return raw.slice(0, MAX_CRITERIA).map((r) => ({
    key: newKey(),
    name: String(r.name ?? "").slice(0, 200),
    description: String(r.description ?? "").slice(0, 1000),
    weight: Math.round(Math.min(100, (Number(r.weight) || 0) * scale)),
    must_have: !!r.must_have,
    ai: true,
  }));
}

/** Payload for `PUT /rubric`: rows that came from the server keep their id; the rest are new. */
export function toPayload(items: EditorItem[]): CriterionInput[] {
  return items.map(({ id, name, description, weight, must_have }) => ({
    ...(id != null ? { id } : {}),
    name: name.trim(),
    description,
    weight,
    must_have,
  }));
}

function Row({
  item,
  index,
  count,
  percent,
  disabled,
  nameError,
  onChange,
  onRemove,
  onMove,
}: {
  item: EditorItem;
  index: number;
  count: number;
  percent: number;
  disabled: boolean;
  nameError?: string;
  onChange: (patch: Partial<EditorItem>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      data-testid="criterion-row"
    >
      <Card variant="outlined" className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            disabled={disabled}
            aria-label={`Drag to reorder criterion ${index + 1}`}
            className="focus-ring mt-3 flex size-8 shrink-0 cursor-grab items-center justify-center rounded-full text-on-surface-variant disabled:opacity-38"
            {...attributes}
            {...listeners}
          >
            <Icon name="drag_indicator" size={20} />
          </button>
          <TextField
            variant="outlined"
            label="Name"
            containerClassName="min-w-0 flex-1"
            value={item.name}
            maxLength={200}
            disabled={disabled}
            error={nameError}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          {item.ai && (
            <span className="mt-4 inline-flex h-6 shrink-0 items-center gap-1 rounded-sm bg-ai-container px-2 label-m text-on-ai-container">
              <Icon name="psychology" size={16} filled />
              AI generated
            </span>
          )}
          {!disabled && (
            <div className="mt-2 flex shrink-0">
              <IconButton icon="arrow_upward" label={`Move ${item.name || "criterion"} up`} size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
              <IconButton icon="arrow_downward" label={`Move ${item.name || "criterion"} down`} size="sm" disabled={index === count - 1} onClick={() => onMove(1)} />
              <IconButton icon="delete" label={`Remove ${item.name || "criterion"}`} size="sm" onClick={onRemove} />
            </div>
          )}
        </div>
        <TextField
          variant="outlined"
          label="Description (what good looks like)"
          multiline
          rows={2}
          maxLength={1000}
          value={item.description}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="grid items-center gap-4 medium:grid-cols-[1fr_auto]">
          <div>
            <p className="label-m text-on-surface-variant">
              Weight {item.weight} <span aria-live="polite">· {percent.toFixed(0)}% of total</span>
            </p>
            <Slider
              aria-label={`Weight for ${item.name || "criterion"}`}
              min={0}
              max={100}
              step={1}
              value={[item.weight]}
              disabled={disabled}
              onValueChange={(v) => onChange({ weight: v[0] })}
            />
          </div>
          <Switch label="Must-have" checked={item.must_have} disabled={disabled} onCheckedChange={(v) => onChange({ must_have: v })} />
        </div>
      </Card>
    </li>
  );
}

export function RubricEditor({ roleId, canWrite, hasDescription }: { roleId: number; canWrite: boolean; hasDescription: boolean }) {
  const rubric = useRubric(roleId);
  if (rubric.isLoading) {
    return (
      <LoadingRegion label="Loading rubric" className="space-y-3">
        <Skeleton className="h-40 rounded-md" />
        <Skeleton className="h-40 rounded-md" />
      </LoadingRegion>
    );
  }
  if (rubric.isError || !rubric.data) {
    return (
      <EmptyState icon="error" title="Could not load rubric">
        {apiMessage(rubric.error)}
      </EmptyState>
    );
  }
  // Remount when the saved rubric changes so the editor re-seeds from the server.
  return (
    <RubricForm
      key={rubric.data.rubric_hash}
      roleId={roleId}
      canWrite={canWrite}
      hasDescription={hasDescription}
      initial={rubric.data.criteria}
    />
  );
}

function RubricForm({
  roleId,
  canWrite,
  hasDescription,
  initial,
}: {
  roleId: number;
  canWrite: boolean;
  hasDescription: boolean;
  initial: Criterion[];
}) {
  const save = useSaveRubric(roleId);
  const { status: suggestStatus, start: startSuggest } = useSuggestRubric(roleId);
  const snackbar = useSnackbar();
  const [items, setItems] = React.useState<EditorItem[]>(() => fromServer(initial));
  const [dirty, setDirty] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Fill from the suggestion once it completes (adjusting state during render, not in an effect).
  const sg = suggestStatus.data;
  if (waiting && sg) {
    if (sg.status === "completed") {
      setWaiting(false);
      if (sg.criteria?.length) {
        setItems(fromSuggestion(sg.criteria));
        setDirty(true);
        setNotice("Suggested rubric loaded. Review it, then save.");
      }
    } else if (sg.status === "failed") {
      setWaiting(false);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const edit = (next: EditorItem[]) => {
    setItems(next);
    setDirty(true);
    setServerError(null);
  };
  const percents = normalisedWeights(items);
  const errors = validateRubric(items);
  const dupName = (i: number) => {
    const n = items[i].name.trim().toLowerCase();
    if (!n) return "Name is required";
    return items.some((o, j) => j !== i && o.name.trim().toLowerCase() === n) ? "Names must be unique" : undefined;
  };
  const invalid = Object.keys(errors).length > 0;
  const suggesting = startSuggest.isPending || waiting;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.key === active.id);
    const to = items.findIndex((i) => i.key === over.id);
    edit(arrayMove(items, from, to));
  };

  const doSave = () =>
    save.mutate(toPayload(items), {
      onSuccess: () => {
        setNotice(null);
        snackbar.show("Rubric saved. Candidates will be re-ranked automatically.");
      },
      onError: (e) => setServerError(e instanceof ApiError ? (RUBRIC_ERROR_MESSAGES[e.code] ?? e.detail) : apiMessage(e)),
    });

  return (
    <div className="space-y-4">
      <p className="body-m text-on-surface-variant">
        Criteria define how resumes are scored (0–5 each, with evidence quotes). Weights are relative and normalised on save. Saving the rubric
        triggers an automatic re-rank of this role&apos;s candidates.
      </p>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="tonal"
            icon="psychology"
            loading={suggesting}
            disabled={!hasDescription}
            onClick={() => {
              setServerError(null);
              startSuggest.mutate(undefined, {
                // Only start listening once the new job exists (avoids filling from a stale earlier result).
                onSuccess: () => setWaiting(true),
                onError: (e) => setServerError(apiMessage(e)),
              });
            }}
          >
            Suggest rubric from JD
          </Button>
          {!hasDescription && <span className="body-s text-on-surface-variant">Add a job description in Settings first.</span>}
          <span aria-live="polite" className="body-s text-on-surface-variant">
            {suggesting ? "Generating a suggestion…" : ""}
          </span>
        </div>
      )}
      {notice && dirty && (
        <p role="status" className="body-m text-on-surface">
          {notice}
        </p>
      )}
      {sg?.status === "failed" && !waiting && (
        <p role="alert" className="body-m text-error">
          Suggestion failed{sg.error ? `: ${sg.error.slice(0, 160)}` : ""}. You can still build the rubric by hand.
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState icon="rule" title="No rubric yet">
          {canWrite ? "Add criteria by hand or generate a suggestion from the job description." : "A recruiter has not defined a rubric."}
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-3">
              {items.map((item, i) => (
                <Row
                  key={item.key}
                  item={item}
                  index={i}
                  count={items.length}
                  percent={percents[i]}
                  disabled={!canWrite}
                  nameError={dirty ? dupName(i) : undefined}
                  onChange={(patch) => edit(items.map((x) => (x.key === item.key ? { ...x, ...patch, ai: patch.ai ?? x.ai } : x)))}
                  onRemove={() => edit(items.filter((x) => x.key !== item.key))}
                  onMove={(d) => edit(arrayMove(items, i, i + d))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outlined"
            icon="add"
            disabled={items.length >= MAX_CRITERIA}
            onClick={() => edit([...items, { key: newKey(), name: "", description: "", weight: 10, must_have: false }])}
          >
            Add criterion ({items.length}/{MAX_CRITERIA})
          </Button>
          <Button icon="save" loading={save.isPending} disabled={!dirty || invalid} onClick={doSave}>
            Save rubric
          </Button>
          {dirty && <span className="label-m text-on-surface-variant">Unsaved changes</span>}
        </div>
      )}
      {canWrite && dirty && invalid && (
        <ul role="alert" className="body-s text-error">
          {Object.entries(errors).map(([code, msg]) => (
            <li key={code}>{msg}</li>
          ))}
        </ul>
      )}
      {serverError && (
        <p role="alert" className="body-m text-error">
          {serverError}
        </p>
      )}
    </div>
  );
}
