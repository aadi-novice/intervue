import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakerTracker } from "../../src/speaker-tracker.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SpeakerTracker", () => {
  it("dedupes consecutive identical speakers", () => {
    const t = new SpeakerTracker({ flush: async () => undefined });
    expect(t.observe({ tMs: 0, name: "A" })).toBe(true);
    expect(t.observe({ tMs: 250, name: "A" })).toBe(false);
    expect(t.observe({ tMs: 500, name: "B" })).toBe(true);
    expect(t.observe({ tMs: 750, name: "A" })).toBe(true);
    expect(t.pending).toBe(3);
  });

  it("flushes every 5 s", async () => {
    const flush = vi.fn(async (_e: unknown[]) => undefined);
    const t = new SpeakerTracker({ flush });
    t.start();
    t.observe({ tMs: 1250, name: "Priya Sharma" });
    await vi.advanceTimersByTimeAsync(4999);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(flush).toHaveBeenCalledWith([{ t_ms: 1250, name: "Priya Sharma" }]);
    await t.stop();
  });

  it("flushes immediately at 200 events", async () => {
    const flush = vi.fn(async (_e: unknown[]) => undefined);
    const t = new SpeakerTracker({ flush });
    for (let i = 0; i < 200; i++) t.observe({ tMs: i, name: `S${i}` });
    await t.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toHaveLength(200);
  });

  it("does not flush empty buffers and flushes the remainder on stop", async () => {
    const flush = vi.fn(async (_e: unknown[]) => undefined);
    const t = new SpeakerTracker({ flush });
    t.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(flush).not.toHaveBeenCalled();
    t.observe({ tMs: 5, name: "X" });
    await t.stop();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("ignores blank names and survives a failing flush", async () => {
    const flush = vi.fn(async (_e: unknown[]): Promise<void> => {
      throw new Error("boom");
    });
    const t = new SpeakerTracker({ flush });
    expect(t.observe({ tMs: 0, name: "  " })).toBe(false);
    t.observe({ tMs: 0, name: "A" });
    await expect(t.flush()).resolves.toBeUndefined();
  });
});
