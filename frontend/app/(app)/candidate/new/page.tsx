"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, CandidateAvatar, Icon, PageHeader, Select, StaggerItem, TextField } from "@/components/m3";
import { api, type Role } from "@/lib/api";

function FileDrop({
  label,
  accept,
  file,
  onFile,
  icon,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: "upload" | "psychology";
}) {
  return (
    <div>
      <p className="mb-2 label-m uppercase text-on-surface-variant">{label}</p>
      <label className="state-layer focus-within:outline-3 focus-within:outline-secondary relative flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-outline-variant p-5 text-on-surface-variant">
        <Icon name={icon} />
        <span className="text-center body-s">{file ? file.name : "Click to upload"}</span>
        <input type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}

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
    <div className="mx-auto max-w-3xl space-y-6 p-4 medium:p-6">
      <PageHeader title="Add Candidate" subtitle="AI will analyze and score the candidate upon submission." />

      <form onSubmit={handleSubmit} className="space-y-5">
        <StaggerItem index={0}>
          <Card variant="outlined" className="space-y-4 p-6">
            <h2 className="title-m">Personal Information</h2>
            <div className="flex items-center gap-4">
              <label className="focus-within:outline-3 focus-within:outline-secondary cursor-pointer rounded-full" title="Choose photo">
                <CandidateAvatar
                  name={`${firstName} ${lastName}`.trim() || "New candidate"}
                  src={avatarPreview}
                  size="xl"
                />
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="Candidate photo"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setAvatarFile(f);
                    setAvatarPreview(f ? URL.createObjectURL(f) : null);
                  }}
                />
              </label>
              <div>
                <p className="label-l">
                  Photo <span className="font-normal text-on-surface-variant">(optional)</span>
                </p>
                <p className="body-s text-on-surface-variant">JPG, PNG or WebP · max 5MB</p>
                {avatarFile && (
                  <Button
                    type="button"
                    variant="text"
                    size="sm"
                    className="-ms-3 text-error"
                    onClick={() => {
                      setAvatarFile(null);
                      setAvatarPreview(null);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-4 medium:grid-cols-2">
              <TextField variant="outlined" label="First Name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} required placeholder="Priya" />
              <TextField variant="outlined" label="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Sharma" />
              <TextField variant="outlined" label="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="priya@email.com" />
              <TextField variant="outlined" label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem index={1}>
          <Card variant="outlined" className="space-y-4 p-6">
            <h2 className="title-m">Role Assignment</h2>
            <Select
              label="Applying For *"
              value={roleId === "" ? undefined : String(roleId)}
              onValueChange={(v) => setRoleId(Number(v))}
              options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
            />
          </Card>
        </StaggerItem>

        <StaggerItem index={2}>
          <Card variant="outlined" className="p-6">
            <h2 className="mb-4 title-m">
              Documents <span className="font-normal text-on-surface-variant">(optional)</span>
            </h2>
            <div className="grid gap-4 medium:grid-cols-2">
              <FileDrop label="Resume (PDF)" accept=".pdf" file={resumeFile} onFile={setResumeFile} icon="upload" />
              <FileDrop label="Interview Transcript (TXT)" accept=".txt" file={transcriptFile} onFile={setTranscriptFile} icon="psychology" />
            </div>
          </Card>
        </StaggerItem>

        <div className="flex items-start gap-3 rounded-md bg-ai-container p-4 text-on-ai-container">
          <Icon name="psychology" size={20} filled />
          <p className="body-s">
            <span className="font-semibold">AI Screening runs automatically</span> once both resume and transcript are uploaded. You can also upload them later from the candidate profile.
          </p>
        </div>

        {error && (
          <p role="alert" className="px-1 body-m text-error">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button asChild variant="outlined">
            <Link href="/dashboard">Cancel</Link>
          </Button>
          <Button type="submit" loading={submitting} icon="psychology">
            {submitting ? "Creating…" : "Add Candidate"}
          </Button>
        </div>
      </form>
    </div>
  );
}
