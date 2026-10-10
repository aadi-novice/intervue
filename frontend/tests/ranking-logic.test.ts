import { describe, expect, it } from "vitest";
import {
  normalisedWeights,
  rankingQuery,
  validateResumeFiles,
  validateRubric,
  type PoolCandidate,
  type SummaryCardData,
} from "@/lib/api-ranking";
import { fromSuggestion, toPayload } from "@/components/ranking/rubric-editor";
import { DEFAULT_POOL_FILTERS, filterPool } from "@/components/ranking/pool-filter";
import { filterPipeline } from "@/components/pipeline/pipeline-filter";
import { toSummaryProps, criterionPercent } from "@/components/ranking/card-adapter";
import { cellDisplay, parseIds } from "@/components/ranking/compare-view";

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name);

describe("rankingQuery", () => {
  it("omits defaults", () => {
    expect(rankingQuery({})).toBe("?limit=200");
    expect(rankingQuery({ minScore: 0, maxScore: 100, stage: "", mustHavesMet: false })).toBe("?limit=200");
  });
  it("serialises active filters", () => {
    const q = new URLSearchParams(
      rankingQuery({ mustHavesMet: true, minScore: 40, maxScore: 90, stage: "interview", interviewed: true, limit: 50 }),
    );
    expect(q.get("must_haves_met")).toBe("true");
    expect(q.get("min_score")).toBe("40");
    expect(q.get("max_score")).toBe("90");
    expect(q.get("stage")).toBe("interview");
    expect(q.get("interviewed")).toBe("true");
    expect(q.get("limit")).toBe("50");
  });
});

describe("validateResumeFiles", () => {
  it("accepts pdf/docx/zip and rejects others, empty and oversize files", () => {
    const { accepted, rejected } = validateResumeFiles([
      file("a.PDF"),
      file("b.docx"),
      file("c.zip"),
      file("d.txt"),
      file("e.pdf", 0),
      file("f.pdf", 11 * 1024 * 1024),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.PDF", "b.docx", "c.zip"]);
    expect(rejected.map((r) => r.name)).toEqual(["d.txt", "e.pdf", "f.pdf"]);
  });
  it("caps at 500 files", () => {
    const many = Array.from({ length: 502 }, (_, i) => file(`r${i}.pdf`));
    const { accepted, rejected } = validateResumeFiles(many);
    expect(accepted).toHaveLength(500);
    expect(rejected).toHaveLength(2);
  });
});

describe("rubric logic", () => {
  it("normalises weights to percentages", () => {
    expect(normalisedWeights([{ weight: 30 }, { weight: 10 }])).toEqual([75, 25]);
    expect(normalisedWeights([{ weight: 0 }, { weight: 0 }])).toEqual([0, 0]);
  });
  it("validates like the backend", () => {
    expect(validateRubric([])).toHaveProperty("rubric_empty");
    expect(validateRubric([{ name: "A", weight: 1 }, { name: "a ", weight: 1 }])).toHaveProperty("rubric_names");
    expect(validateRubric([{ name: "", weight: 1 }])).toHaveProperty("rubric_names");
    expect(validateRubric([{ name: "A", weight: 0 }])).toHaveProperty("rubric_weights");
    const many = Array.from({ length: 13 }, (_, i) => ({ name: `c${i}`, weight: 1 }));
    expect(validateRubric(many)).toHaveProperty("rubric_too_large");
    expect(validateRubric([{ name: "A", weight: 5 }])).toEqual({});
  });
  it("keeps ids of saved rows and omits them for new rows", () => {
    const payload = toPayload([
      { key: "a", id: 7, name: " Rust ", description: "", weight: 50, must_have: true },
      { key: "b", name: "SQL", description: "d", weight: 50, must_have: false },
    ]);
    expect(payload[0]).toEqual({ id: 7, name: "Rust", description: "", weight: 50, must_have: true });
    expect("id" in payload[1]).toBe(false);
  });
  it("marks suggestions as AI generated and scales fractional weights", () => {
    const rows = fromSuggestion([{ name: "X", weight: 0.4 }, { name: "Y", weight: 0.6, must_have: true }]);
    expect(rows.map((r) => r.weight)).toEqual([40, 60]);
    expect(rows.every((r) => r.ai)).toBe(true);
    expect(rows[1].must_have).toBe(true);
  });
});

const pc = (o: Partial<PoolCandidate>): PoolCandidate =>
  ({
    id: "1", name: "Ada", role: "Rust Eng", score: 80, avatar: "A", color: "", days: 1, ai: false, stage: "applied",
    email: "a@x.io", phone: null, role_id: 1, resume_path: null, transcript_path: null, avatar_url: null,
    source: "bulk", interviewed: false, best_match: null, ...o,
  }) as PoolCandidate;

describe("filters", () => {
  it("filters the talent pool", () => {
    const list = [pc({ id: "1" }), pc({ id: "2", name: "Bo", role_id: 2, stage: "offer", score: 30, source: null, interviewed: true })];
    expect(filterPool(list, DEFAULT_POOL_FILTERS)).toHaveLength(2);
    expect(filterPool(list, { ...DEFAULT_POOL_FILTERS, roleId: 2 }).map((c) => c.id)).toEqual(["2"]);
    expect(filterPool(list, { ...DEFAULT_POOL_FILTERS, minScore: 50 }).map((c) => c.id)).toEqual(["1"]);
    expect(filterPool(list, { ...DEFAULT_POOL_FILTERS, source: "manual" }).map((c) => c.id)).toEqual(["2"]);
    expect(filterPool(list, { ...DEFAULT_POOL_FILTERS, interviewedOnly: true }).map((c) => c.id)).toEqual(["2"]);
    expect(filterPool(list, { ...DEFAULT_POOL_FILTERS, search: "bo" }).map((c) => c.id)).toEqual(["2"]);
  });
  it("restricts the pipeline to a role", () => {
    const cands = [
      { id: "1", name: "A", role_id: 1 },
      { id: "2", name: "B", role_id: 2 },
    ] as Parameters<typeof filterPipeline>[0];
    expect(filterPipeline(cands, { roleId: 2 }).map((c) => c.id)).toEqual(["2"]);
    expect(filterPipeline(cands, { search: "a" }).map((c) => c.id)).toEqual(["1"]);
  });
});

describe("card adapter + compare helpers", () => {
  const card = (blind: boolean): SummaryCardData => ({
    candidate: { id: 1, name: blind ? "Candidate 4" : "Ada L", email: blind ? null : "ada@x.io", avatar_url: blind ? null : "http://img", avatar: "AL", stage: "applied", blind, role_id: 1 },
    role_id: 1,
    resume_fit: {
      status: "scored", overall_score: 82, vector_similarity: 0.8, must_have_failed: false, explanation: null, stale: false,
      criteria: [{ criterion_id: 1, name: "Rust", weight: 1, must_have: true, score: 4, evidence: ["5y Rust"], reasoning: "" }],
    },
    interview: null,
    claim_checks: { verified: 1, unclear: 0, contradicted: 1, flags: [
      { claim: "ok", verdict: "verified", severity: "low", segment_ids: [], interview_id: null },
      { claim: "bad", verdict: "contradicted", severity: "high", segment_ids: [], interview_id: null },
    ] },
    notes_excerpt: null,
    suggestion: { label: "Lean no", basis: "resume", caption: "AI suggestion — final decision by your team" },
  });
  it("maps scores, suggestion and claim flags", () => {
    const p = toSummaryProps(card(false));
    expect(p.fitScore).toBe(82);
    expect(p.criteria).toEqual([{ label: "Rust", score: 80 }]);
    expect(p.aiSuggestion).toBe("lean_no");
    expect(p.claimFlags).toEqual([{ status: "contradicted", text: "bad" }]);
    expect(criterionPercent(5)).toBe(100);
  });
  it("never exposes avatar or email for blind candidates", () => {
    const p = toSummaryProps(card(true));
    expect(p.avatarSrc).toBeNull();
    expect(p.subtitle).toBeUndefined();
  });
  it("parses ids and formats compare cells", () => {
    expect(parseIds("3,3,x,5,-1,7,8,9")).toEqual([3, 5, 7, 8]);
    expect(cellDisplay("criterion", 4)).toEqual({ percent: 80, text: "4/5" });
    expect(cellDisplay("resume", null)).toBeNull();
  });
});
