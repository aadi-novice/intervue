"use client";

import { useState } from "react";
import { Button, PageHeader } from "@/components/m3";
import { RequireRole } from "@/components/require-role";
import { InterviewsExplorer } from "@/components/interviews/interviews-explorer";
import { ScheduleDialog } from "@/components/interviews/schedule-dialog";
import { CAN } from "@/lib/roles";

export default function InterviewsPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6 p-4 medium:p-6">
      <PageHeader
        title="Interviews"
        subtitle="Schedule calls, send the notetaker, and review transcripts and AI analysis."
        actions={
          <RequireRole roles={CAN.create}>
            <Button icon="add_link" onClick={() => setOpen(true)}>
              Paste meeting link
            </Button>
          </RequireRole>
        }
      />
      <InterviewsExplorer />
      <ScheduleDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
