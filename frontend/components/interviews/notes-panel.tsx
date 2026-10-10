"use client";

import { Card, EmptyState } from "@/components/m3";
import type { InterviewNotes } from "@/lib/api-interviews";

/** Notes items may be plain strings or small objects; render whatever text they contain. */
export function itemText(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const k of ["text", "point", "topic", "title", "name", "question", "summary"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    return Object.values(o).filter((v) => typeof v === "string").join(" - ");
  }
  return String(x ?? "");
}

function Section({ title, items }: { title: string; items: unknown[] }) {
  const list = items.map(itemText).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 label-l text-on-surface-variant">{title}</h4>
      <ul className="list-disc space-y-1 ps-5 body-m">
        {list.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export function NotesPanel({ notes }: { notes: InterviewNotes | null }) {
  if (!notes) {
    return (
      <Card variant="outlined" className="border-dashed">
        <EmptyState icon="notes" title="No notes yet">
          Notes are generated after the transcript is ready.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card variant="outlined" className="space-y-5 p-5">
      <div>
        <h3 className="mb-2 title-m">Summary</h3>
        <p className="body-m text-on-surface-variant">{notes.summary}</p>
      </div>
      <Section title="Key points" items={notes.key_points} />
      <Section title="Topics covered" items={notes.topics} />
      <Section title="Follow-ups for the next round" items={notes.follow_ups} />
    </Card>
  );
}
