"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  IconButton,
  List,
  ListItem,
  Select,
  Skeleton,
  TextField,
  CandidateAvatar,
  useSnackbar,
} from "@/components/m3";
import { FormError } from "@/components/auth/auth-ui";
import { currentOrg, useAuthStore, type OrgRole } from "@/lib/auth-store";
import type { Member } from "@/lib/api";
import { CAN, ROLE_LABELS, ROLE_OPTIONS, roleAllowed, useRole } from "@/lib/roles";
import { errorMessage, useInviteMember, useMembers, useRemoveMember } from "@/lib/queries/auth";
import { RequireRole } from "@/components/require-role";

const ROLE_TONE: Record<OrgRole, string> = {
  admin: "bg-primary-container text-on-primary-container",
  recruiter: "bg-secondary-container text-on-secondary-container",
  hiring_manager: "bg-tertiary-container text-on-tertiary-container",
  interviewer: "bg-surface-container-highest text-on-surface-variant",
};

function RoleChip({ role }: { role: OrgRole }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-sm px-2 label-m ${ROLE_TONE[role]}`}>{ROLE_LABELS[role]}</span>
  );
}

function InviteDialog({ orgId }: { orgId: number }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("recruiter");
  const invite = useInviteMember(orgId);
  const snackbar = useSnackbar();

  const reset = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setEmail("");
      setRole("recruiter");
      invite.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <Button icon="person_add" onClick={() => setOpen(true)}>
        Invite member
      </Button>
      <DialogContent
        title="Invite a teammate"
        description="They will receive an email with a link to join this organization."
        actions={
          <>
            <DialogClose asChild>
              <Button variant="text">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              form="invite-form"
              loading={invite.isPending}
              disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
            >
              Send invite
            </Button>
          </>
        }
      >
        <form
          id="invite-form"
          noValidate
          className="space-y-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(
              { email: email.trim(), role },
              {
                onSuccess: () => {
                  snackbar.show(`Invitation sent to ${email.trim()}`);
                  reset(false);
                },
              },
            );
          }}
        >
          <FormError message={invite.isError ? errorMessage(invite.error) : null} />
          <TextField
            label="Email"
            variant="outlined"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select label="Role" options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as OrgRole)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  orgId,
  member,
  onClose,
}: {
  orgId: number;
  member: Member | null;
  onClose: () => void;
}) {
  const remove = useRemoveMember(orgId);
  const snackbar = useSnackbar();
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => {
        if (!o) {
          remove.reset();
          onClose();
        }
      }}
    >
      <DialogContent
        icon="person_remove"
        title="Remove member?"
        description={member ? `${member.full_name} (${member.email}) will lose access to this organization.` : undefined}
        actions={
          <>
            <DialogClose asChild>
              <Button variant="text">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                member &&
                remove.mutate(member.user_id, {
                  onSuccess: () => {
                    snackbar.show(`${member.full_name} removed`);
                    onClose();
                  },
                })
              }
            >
              Remove
            </Button>
          </>
        }
      >
        <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      </DialogContent>
    </Dialog>
  );
}

export function MembersSettings() {
  const org = useAuthStore((s) => currentOrg(s));
  const user = useAuthStore((s) => s.user);
  const role = useRole();
  const canView = roleAllowed(role, CAN.viewMembers);
  const isAdmin = roleAllowed(role, CAN.admin);
  const members = useMembers(org?.id ?? null, canView);
  const [removing, setRemoving] = useState<Member | null>(null);

  if (!org) return null;

  if (!canView) {
    return (
      <Card variant="outlined" className="max-w-3xl p-5">
        <EmptyState icon="lock" title="Members are not visible to your role">
          Ask an organization admin if you need to see who is on the team.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card variant="outlined" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-2">
        <div>
          <h2 className="title-m">Members</h2>
          <p className="body-s text-on-surface-variant">People with access to {org.name}.</p>
        </div>
        <RequireRole roles={CAN.admin}>
          <InviteDialog orgId={org.id} />
        </RequireRole>
      </div>

      {members.isPending ? (
        <div className="space-y-2 p-5" role="status" aria-busy="true">
          <span className="sr-only">Loading members</span>
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
        </div>
      ) : members.isError ? (
        <div className="p-5">
          <FormError message={errorMessage(members.error)} />
        </div>
      ) : (
        <List>
          {members.data.map((m) => (
            <ListItem
              key={m.user_id}
              leading={<CandidateAvatar name={m.full_name || m.email} size="md" />}
              headline={
                <span>
                  {m.full_name}
                  {m.user_id === user?.id && <span className="ms-2 label-s text-on-surface-variant">(you)</span>}
                </span>
              }
              supporting={m.email}
              trailing={
                <div className="flex items-center gap-2">
                  <RoleChip role={m.role} />
                  {isAdmin && (
                    <IconButton
                      icon="person_remove"
                      label={`Remove ${m.full_name}`}
                      onClick={() => setRemoving(m)}
                    />
                  )}
                </div>
              }
            />
          ))}
        </List>
      )}

      <RemoveDialog orgId={org.id} member={removing} onClose={() => setRemoving(null)} />
    </Card>
  );
}
