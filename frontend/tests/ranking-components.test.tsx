import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { SnackbarProvider } from "@/components/m3/snackbar";
import { CandidateSummaryCard } from "@/components/ranking/candidate-summary-card";
import { CompareTable } from "@/components/ranking/compare-view";
import { BulkUpload } from "@/components/ranking/bulk-upload";
import { useAuthStore } from "@/lib/auth-store";
import type { CompareMatrix, SummaryCardData } from "@/lib/api-ranking";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SnackbarProvider>{ui}</SnackbarProvider>
    </QueryClientProvider>,
  );
}

const card = (blind: boolean): SummaryCardData => ({
  candidate: {
    id: 1,
    name: blind ? "Candidate 4" : "Ada Lovelace",
    email: blind ? null : "ada@example.com",
    avatar_url: blind ? null : "http://img/ada.png",
    avatar: "AL",
    stage: "applied",
    blind,
    role_id: 1,
  },
  role_id: 1,
  resume_fit: {
    status: "scored",
    overall_score: 71,
    vector_similarity: 0.7,
    must_have_failed: true,
    explanation: null,
    stale: false,
    criteria: [{ criterion_id: 1, name: "Rust", weight: 1, must_have: true, score: 1, evidence: ["Worked with Go only"], reasoning: "No Rust." }],
  },
  interview: null,
  claim_checks: { verified: 0, unclear: 0, contradicted: 0, flags: [] },
  notes_excerpt: null,
  suggestion: { label: "Lean no", basis: "resume", caption: "AI suggestion — final decision by your team" },
});

beforeEach(() => {
  useAuthStore.setState({ orgs: [{ id: 1, name: "Acme", slug: "acme", role: "recruiter", settings: {} }], currentOrgId: 1 });
});

describe("CandidateSummaryCard", () => {
  it("shows identity, must-have warning and AI caption for normal candidates", () => {
    wrap(<CandidateSummaryCard card={card(false)} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Missing a must-have")).toBeInTheDocument();
    expect(screen.getByText("AI suggestion — final decision by your team")).toBeInTheDocument();
    expect(screen.queryByText("Identity hidden")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reveal/ })).toBeNull();
  });

  it("masks blind candidates and offers Reveal", () => {
    const { container } = wrap(<CandidateSummaryCard card={card(true)} />);
    expect(screen.getByText("Candidate 4")).toBeInTheDocument();
    expect(screen.getByText("Identity hidden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reveal identity of Candidate 4/ })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("@");
  });

  it("expands evidence quotes",  () => {
    wrap(<CandidateSummaryCard card={card(false)} />);
    expect(screen.queryByText(/Worked with Go only/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show evidence/ }));
    expect(screen.getByText(/Worked with Go only/)).toBeInTheDocument();
  });
});

describe("CompareTable", () => {
  const data: CompareMatrix = {
    role_id: 1,
    candidates: [
      { id: 1, name: "Ada", email: "a@x.io", avatar_url: null, avatar: "A", stage: "applied", blind: false, role_id: 1 },
      { id: 2, name: "Candidate 2", email: null, avatar_url: null, avatar: "?", stage: "applied", blind: true, role_id: 1 },
    ],
    rows: [
      {
        key: "overall", label: "Resume fit", kind: "resume", best_candidate_ids: [2],
        cells: [{ candidate_id: 1, value: 60, evidence: [] }, { candidate_id: 2, value: 90, evidence: [] }],
      },
    ],
    suggestions: { "1": { label: "Yes", basis: "resume", caption: "" }, "2": { label: null, basis: "none", caption: "" } },
  };
  it("highlights the best cell and masks blind headers", () => {
    const { container } = wrap(<CompareTable data={data} />);
    const best = container.querySelectorAll("[data-best]");
    expect(best).toHaveLength(1);
    expect(best[0].textContent).toContain("90");
    expect(screen.getByText("Identity hidden")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });
});

describe("BulkUpload", () => {
  it("reports rejected files client-side without calling the API", async () => {
    wrap(<BulkUpload roleId={1} />);
    const input = screen.getByTestId("bulk-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText(/notes.txt: Only PDF, DOCX or ZIP/)).toBeInTheDocument();
  });
});
