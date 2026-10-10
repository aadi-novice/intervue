"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Button,
  Card,
  IconButton,
  InputChip,
  PageHeader,
  Select,
  StaggerItem,
  SuggestionChip,
  TextField,
} from "@/components/m3";
import { api } from "@/lib/api";

const SKILL_SUGGESTIONS = ["Rust", "Go", "TypeScript", "Python", "gRPC", "K8s", "AWS", "WebAssembly", "Tokio", "React"];
const EXPERIENCE_LEVELS = ["junior", "mid", "senior", "staff", "principal"];

export default function NewRolePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("senior");
  const [experienceYears, setExperienceYears] = useState(3);
  const [skills, setSkills] = useState<string[]>(["Rust", "gRPC"]);
  const [skillInput, setSkillInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSkill = (s: string) => {
    if (s && !skills.includes(s)) setSkills([...skills, s]);
    setSkillInput("");
  };
  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) {
      setError("Job title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.roles.create({
        name: title,
        experience_level: experienceLevel,
        experience_required_years: experienceYears,
      });
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 medium:p-6">
      <PageHeader title="Post New Role" subtitle="AI will begin sourcing and screening candidates immediately." />

      <form onSubmit={handleSubmit} className="space-y-5">
        <StaggerItem index={0}>
          <Card variant="outlined" className="space-y-4 p-6">
            <h2 className="title-m">Role Details</h2>
            <TextField
              variant="outlined"
              label="Job Title *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Senior Rust Engineer"
            />
            <div className="grid gap-4 medium:grid-cols-2">
              <Select
                label="Seniority Level"
                value={experienceLevel}
                onValueChange={setExperienceLevel}
                options={EXPERIENCE_LEVELS.map((l) => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1) }))}
              />
              <TextField
                variant="outlined"
                label="Years Required"
                type="number"
                min={0}
                max={20}
                value={experienceYears}
                onChange={(e) => setExperienceYears(Number(e.target.value))}
              />
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem index={1}>
          <Card variant="outlined" className="p-6">
            <h2 className="mb-4 title-m">Required Skills</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {skills.map((s) => (
                <InputChip key={s} label={s} onRemove={() => removeSkill(s)} />
              ))}
            </div>
            <div className="flex items-start gap-2">
              <TextField
                variant="outlined"
                label="Add skill"
                containerClassName="flex-1"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill(skillInput))}
              />
              <IconButton variant="tonal" size="lg" icon="add" label="Add skill" className="mt-1" onClick={() => addSkill(skillInput)} />
            </div>
            <div className="mt-4">
              <p className="mb-2 label-m text-on-surface-variant">Suggestions</p>
              <div className="flex flex-wrap gap-2">
                {SKILL_SUGGESTIONS.filter((s) => !skills.includes(s)).map((s) => (
                  <SuggestionChip key={s} label={s} icon="add" onClick={() => addSkill(s)} />
                ))}
              </div>
            </div>
          </Card>
        </StaggerItem>

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
            {submitting ? "Posting…" : "Post Role & Start AI Sourcing"}
          </Button>
        </div>
      </form>
    </div>
  );
}
