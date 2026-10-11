import "./api";

declare module "./api" {
  interface CandidateDetail {
    /** Why parsing failed (only set when `resume_parse_status` is `failed`). */
    resume_parse_error?: string | null;
  }
}

/** The backend now also reports `failed`; `ResumeParseStatus` in `api.ts` predates it. */
export type ResumeParseState = "no_resume" | "pending" | "ready" | "failed";

export const resumeParseState = (c: { resume_parse_status?: string | null } | null | undefined): ResumeParseState | null =>
  (c?.resume_parse_status as ResumeParseState | undefined) ?? null;

/** Only `pending` keeps the candidate polling; `failed` is terminal. */
export const isParsePending = (c: { resume_parse_status?: string | null } | null | undefined) =>
  resumeParseState(c) === "pending";

export const isParseFailed = (c: { resume_parse_status?: string | null } | null | undefined) =>
  resumeParseState(c) === "failed";

export const PARSE_FAILED_HINT = "Upload a different file (a text-based PDF or a DOCX) to try again.";
