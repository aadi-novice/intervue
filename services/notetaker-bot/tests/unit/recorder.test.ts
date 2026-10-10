import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "../../src/logger.js";
import {
  Recorder,
  buildFfmpegArgs,
  chunkBlobName,
  parseSegmentList,
  type ChildLike,
  type ChunkInfo,
  type FsLike,
} from "../../src/recorder.js";

const DIR = path.join("work", "s1");

class FakeFs implements FsLike {
  files = new Map<string, Uint8Array>();
  async mkdir() {
    return undefined;
  }
  async readdir(dir: string) {
    return [...this.files.keys()].filter((k) => path.dirname(k) === dir).map((k) => path.basename(k));
  }
  async readFile(p: string) {
    const d = this.files.get(p);
    if (!d) throw new Error("ENOENT " + p);
    return d;
  }
  put(name: string, bytes = [1, 2, 3]) {
    this.files.set(path.join(DIR, name), new Uint8Array(bytes));
  }
}

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  signals: string[] = [];
  kill(sig?: NodeJS.Signals) {
    this.signals.push(sig ?? "SIGTERM");
    setTimeout(() => this.emit("exit", 0, null), 0);
    return true;
  }
}

function setup(over: { chunkSeconds?: number; upload?: (c: ChunkInfo, d: Uint8Array) => Promise<void> } = {}) {
  const fs = new FakeFs();
  const children: FakeChild[] = [];
  const spawnArgs: string[][] = [];
  const uploads: ChunkInfo[] = [];
  let t = 1_000_000;
  const rec = new Recorder({
    workDir: DIR,
    pulseSink: "intervue_sink",
    chunkSeconds: over.chunkSeconds ?? 30,
    uploadPrefix: "recordings/s1/",
    logger: createSilentLogger(),
    fs,
    now: () => t,
    spawn: (_cmd, args) => {
      spawnArgs.push(args);
      const c = new FakeChild();
      children.push(c);
      return c as unknown as ChildLike;
    },
    upload:
      over.upload ??
      (async (chunk) => {
        uploads.push(chunk);
      }),
    watchIntervalMs: 1000,
    restartDelayMs: 1,
  });
  return { rec, fs, children, spawnArgs, uploads, advance: (ms: number) => (t += ms) };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

describe("ffmpeg args", () => {
  it("reads the sink monitor and writes 16 kHz mono opus segments", () => {
    const a = buildFfmpegArgs({ pulseSink: "intervue_sink", chunkSeconds: 30, workDir: "w", startNumber: 0, segmentListPath: "l.csv" });
    const s = a.join(" ");
    expect(s).toContain("-f pulse -i intervue_sink.monitor");
    expect(s).toContain("-ac 1");
    expect(s).toContain("-ar 16000");
    expect(s).toContain("-c:a libopus");
    expect(s).toContain("-f segment -segment_time 30");
    expect(a[a.length - 1]).toBe(path.join("w", "chunk_%04d.opus"));
  });
});

describe("helpers", () => {
  it("names blobs with zero padding", () => {
    expect(chunkBlobName("recordings/s1/", 12)).toBe("recordings/s1/0012.opus");
  });
  it("parses the csv segment list", () => {
    const m = parseSegmentList("chunk_0000.opus,0.000000,30.020000\nchunk_0001.opus,30.020000,60.000000\n");
    expect(m.get("chunk_0001.opus")).toEqual({ start: 30.02, end: 60 });
  });
});

describe("Recorder chunk watcher", () => {
  it("uploads a chunk only once the next one appears, and the last one on stop", async () => {
    const { rec, fs, uploads, children } = setup();
    await rec.start();
    expect(children).toHaveLength(1);

    fs.put("chunk_0000.opus");
    await rec.scan(false);
    expect(uploads).toHaveLength(0); // still being written

    fs.put("chunk_0001.opus");
    await rec.scan(false);
    await vi.waitFor(() => expect(uploads.map((u) => u.index)).toEqual([0]));
    expect(uploads[0]).toMatchObject({ blob: "recordings/s1/0000.opus", start_ms: 0, duration_ms: 30000 });

    // Scanning again must not re-upload.
    await rec.scan(false);
    expect(uploads).toHaveLength(1);

    fs.put("chunk_0002.opus");
    fs.put("chunk_0000.opus"); // unchanged
    const result = await rec.stop();
    expect(children[0]!.signals).toContain("SIGINT");
    expect(uploads.map((u) => u.index)).toEqual([0, 1, 2]);
    expect(result.chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("uses ffmpeg's segment list for exact timing", async () => {
    const { rec, fs, uploads } = setup();
    await rec.start();
    fs.files.set(path.join(DIR, "segments_0.csv"), new TextEncoder().encode("chunk_0000.opus,0.000000,30.020000\nchunk_0001.opus,30.020000,41.500000\n"));
    fs.put("chunk_0000.opus");
    fs.put("chunk_0001.opus");
    const result = await rec.stop();
    expect(uploads[1]).toMatchObject({ index: 1, start_ms: 30020, duration_ms: 11480 });
    expect(result.durationMs).toBe(41500);
  });

  it("estimates the last chunk duration from elapsed time when there is no list", async () => {
    const { rec, fs, uploads, advance } = setup();
    await rec.start();
    advance(40_000);
    fs.put("chunk_0000.opus");
    fs.put("chunk_0001.opus");
    const result = await rec.stop();
    expect(uploads[0]!.duration_ms).toBe(30000);
    expect(uploads[1]).toMatchObject({ start_ms: 30000, duration_ms: 10000 });
    expect(result.durationMs).toBe(40000);
  });

  it("skips empty chunks", async () => {
    const { rec, fs, uploads } = setup();
    await rec.start();
    fs.put("chunk_0000.opus", []);
    await rec.stop();
    expect(uploads).toHaveLength(0);
  });

  it("retries a failed chunk upload once at stop and reports only uploaded chunks", async () => {
    let calls = 0;
    const ok: ChunkInfo[] = [];
    const { rec, fs } = setup({
      upload: async (c) => {
        if (++calls === 1) throw new Error("net");
        ok.push(c);
      },
    });
    await rec.start();
    fs.put("chunk_0000.opus");
    const result = await rec.stop();
    expect(calls).toBe(2);
    expect(ok.map((c) => c.index)).toEqual([0]);
    expect(result.chunks).toHaveLength(1);
  });

  it("restarts ffmpeg after a crash, continuing the chunk numbering", async () => {
    const { rec, fs, children, spawnArgs, uploads } = setup();
    await rec.start();
    fs.put("chunk_0000.opus");
    children[0]!.emit("exit", 1, null);
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2000, interval: 5 });
    expect(spawnArgs[1]!.join(" ")).toContain("-segment_start_number 1");
    expect(uploads.map((u) => u.index)).toEqual([0]);
    fs.put("chunk_0001.opus");
    await rec.stop();
    expect(uploads.map((u) => u.index)).toEqual([0, 1]);
  });

  it("reports onFatal after too many ffmpeg failures", async () => {
    const onFatal = vi.fn();
    const fs = new FakeFs();
    const children: FakeChild[] = [];
    const rec = new Recorder({
      workDir: DIR,
      pulseSink: "s",
      chunkSeconds: 30,
      uploadPrefix: "p/",
      logger: createSilentLogger(),
      fs,
      maxRestarts: 1,
      restartDelayMs: 1,
      onFatal,
      spawn: () => {
        const c = new FakeChild();
        children.push(c);
        return c as unknown as ChildLike;
      },
      upload: async () => undefined,
    });
    await rec.start();
    children[0]!.emit("exit", 1, null);
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2000, interval: 5 });
    children[1]!.emit("exit", 1, null);
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalled(), { timeout: 2000, interval: 5 });
  });
});
