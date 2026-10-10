import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalysisView } from "@/components/interviews/analysis-panel";
import type { InterviewAnalysis } from "@/lib/api-interviews";

const base: InterviewAnalysis = {
  id: 1,
  summary: "Solid candidate.",
  strengths: [],
  weaknesses: [],
  technical_score: 80,
  communication_score: 70,
  confidence_score: 60,
  key_moments: [],
  resume_alignment: [],
  candidate_id: 3,
  interview_id: 7,
  hiring_recommendation: "hire",
  created_at: "2026-01-01T00:00:00Z",
};

describe("AnalysisView", () => {
  it("renders cited strengths as links to transcript segments", () => {
    render(
      <AnalysisView
        interviewId={7}
        analysis={{ ...base, strengths: [{ text: "Great systems thinking", segment_ids: [11, 12] }] }}
      />,
    );
    expect(screen.getByText(/Great systems thinking/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Open transcript segment/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/interviews/7?tab=transcript&seg=11",
      "/interviews/7?tab=transcript&seg=12",
    ]);
  });

  it("renders legacy plain-string strengths without citations", () => {
    render(<AnalysisView interviewId={null} analysis={{ ...base, interview_id: null, strengths: ["Knows Rust"], weaknesses: ["Light on testing"] }} />);
    expect(screen.getByText("Knows Rust")).toBeInTheDocument();
    expect(screen.getByText("Light on testing")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the AI suggestion caption and claim checks with verdicts", () => {
    render(
      <AnalysisView
        interviewId={7}
        analysis={{
          ...base,
          resume_alignment: [
            { claim: "Led a team of 5", resume_quote: "Led 5 engineers", verdict: "contradicted", result: "Said they were an IC", segment_ids: [4] },
            { claim: "Knows Go", result: "Not discussed", severity: "medium" },
          ],
        }}
      />,
    );
    expect(screen.getByText("AI suggestion — final decision by your team")).toBeInTheDocument();
    expect(screen.getByText("Contradicted")).toBeInTheDocument();
    expect(screen.getByText("Unclear")).toBeInTheDocument();
    expect(screen.getByText(/Led 5 engineers/)).toBeInTheDocument();
    expect(screen.getByText("Said they were an IC")).toBeInTheDocument();
  });

  it("links key moments to their segment", () => {
    render(<AnalysisView interviewId={7} analysis={{ ...base, key_moments: [{ moment: "Explained sharding", signal: "depth", segment_id: 9, timestamp_ms: 65000 }] }} />);
    expect(screen.getByRole("link", { name: /Open transcript at 1:05/ })).toHaveAttribute("href", "/interviews/7?tab=transcript&seg=9");
  });
});
