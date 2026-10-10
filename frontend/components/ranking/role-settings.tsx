"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogContent, Select, TextField } from "@/components/m3";
import { useSnackbar } from "@/components/m3/snackbar";
import { apiMessage, type RoleFull, type RoleStatus } from "@/lib/api-ranking";
import { useDeleteRole, useUpdateRole } from "@/lib/queries/ranking";

export const EXPERIENCE_LEVELS = ["junior", "mid", "senior", "staff", "principal"];
export const STATUS_OPTIONS: { value: RoleStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
];

export function RoleSettings({ role, canWrite }: { role: RoleFull; canWrite: boolean }) {
  const router = useRouter();
  const snackbar = useSnackbar();
  const update = useUpdateRole(role.id);
  const remove = useDeleteRole();
  const [name, setName] = React.useState(role.name);
  const [level, setLevel] = React.useState(role.experience_level);
  const [years, setYears] = React.useState(role.experience_required_years);
  const [jd, setJd] = React.useState(role.description ?? "");
  const [status, setStatus] = React.useState<RoleStatus>(role.status);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const levels = EXPERIENCE_LEVELS.includes(level) ? EXPERIENCE_LEVELS : [...EXPERIENCE_LEVELS, level];

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Job title is required.");
    setError(null);
    update.mutate(
      { name: name.trim(), experience_level: level, experience_required_years: years, description: jd, status },
      {
        onSuccess: () => snackbar.show("Role updated"),
        onError: (err) => setError(apiMessage(err)),
      },
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField variant="outlined" label="Job title" value={name} disabled={!canWrite} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-4 medium:grid-cols-3">
          <Select
            label="Seniority"
            value={level}
            disabled={!canWrite}
            onValueChange={setLevel}
            options={levels.map((l) => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1) }))}
          />
          <TextField
            variant="outlined"
            label="Years required"
            type="number"
            min={0}
            max={60}
            value={years}
            disabled={!canWrite}
            onChange={(e) => setYears(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
          />
          <Select label="Status" value={status} disabled={!canWrite} onValueChange={(v) => setStatus(v as RoleStatus)} options={STATUS_OPTIONS} />
        </div>
        <TextField
          variant="outlined"
          label="Job description"
          multiline
          rows={10}
          value={jd}
          disabled={!canWrite}
          supportingText="Used for embeddings, rubric suggestions and ranking."
          onChange={(e) => setJd(e.target.value)}
        />
        {error && (
          <p role="alert" className="body-m text-error">
            {error}
          </p>
        )}
        {canWrite && (
          <Button type="submit" icon="save" loading={update.isPending}>
            Save changes
          </Button>
        )}
      </form>

      {canWrite && (
        <section className="rounded-md border border-error/40 p-4">
          <h3 className="title-s text-error">Delete role</h3>
          <p className="mt-1 body-s text-on-surface-variant">A role with candidates assigned cannot be deleted.</p>
          <Button className="mt-3" variant="danger" icon="delete" onClick={() => setConfirmDelete(true)}>
            Delete role
          </Button>
          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <DialogContent
              icon="delete"
              title={`Delete ${role.name}?`}
              description="This permanently removes the role and its rubric."
              actions={
                <>
                  <Button variant="text" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    loading={remove.isPending}
                    onClick={() =>
                      remove.mutate(role.id, {
                        onSuccess: () => router.replace("/roles"),
                        onError: (err) => setDeleteError(apiMessage(err)),
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              }
            >
              {deleteError && (
                <p role="alert" className="body-m text-error">
                  {deleteError}
                </p>
              )}
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}
