import { spawn as nodeSpawn } from "node:child_process";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.js";

export const AUDIO_MIME_TYPE = "audio/ogg";

export interface ChunkInfo {
  index: number;
  blob: string;
  start_ms: number;
  duration_ms: number;
}

/** Minimal child-process surface we use (lets tests inject a fake). */
export interface ChildLike {
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
}

export type SpawnFn = (command: string, args: string[]) => ChildLike;

export interface FsLike {
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  readdir(p: string): Promise<string[]>;
  readFile(p: string): Promise<Uint8Array>;
}

export interface RecorderOptions {
  workDir: string;
  pulseSink: string;
  chunkSeconds: number;
  uploadPrefix: string;
  logger: Logger;
  /** Uploads one chunk (and emits chunk_uploaded). Throwing marks the chunk for a retry at stop. */
  upload: (chunk: ChunkInfo, data: Uint8Array) => Promise<void>;
  /** Called if ffmpeg cannot be kept running. */
  onFatal?: (err: Error) => void;
  ffmpegPath?: string;
  spawn?: SpawnFn;
  fs?: FsLike;
  now?: () => number;
  watchIntervalMs?: number;
  stopTimeoutMs?: number;
  maxRestarts?: number;
  restartDelayMs?: number;
}

export interface RecordingResult {
  startedAt: number;
  durationMs: number;
  chunks: ChunkInfo[];
}

const CHUNK_RE = /^chunk_(\d{4,})\.opus$/;

export function chunkFileName(index: number): string {
  return `chunk_${String(index).padStart(4, "0")}.opus`;
}

export function chunkBlobName(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(4, "0")}.opus`;
}

/** ffmpeg: PulseAudio monitor -> 16 kHz mono Opus, cut into N-second Ogg segments. */
export function buildFfmpegArgs(opts: {
  pulseSink: string;
  chunkSeconds: number;
  workDir: string;
  startNumber: number;
  segmentListPath: string;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-y",
    "-f", "pulse",
    "-i", `${opts.pulseSink}.monitor`,
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "libopus",
    "-b:a", "32k",
    "-application", "voip",
    "-f", "segment",
    "-segment_time", String(opts.chunkSeconds),
    "-segment_format", "ogg",
    "-segment_start_number", String(opts.startNumber),
    "-segment_list", opts.segmentListPath,
    "-segment_list_type", "csv",
    "-reset_timestamps", "1",
    path.join(opts.workDir, "chunk_%04d.opus"),
  ];
}

/** Parses ffmpeg's csv segment list: `chunk_0003.opus,90.000000,120.000000`. */
export function parseSegmentList(text: string): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(",");
    if (parts.length < 3) continue;
    const [file, s, e] = parts as [string, string, string];
    const start = Number(s);
    const end = Number(e);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) out.set(path.basename(file), { start, end });
  }
  return out;
}

interface Run {
  startIndex: number;
  offsetMs: number;
  listPath: string;
}

/**
 * Runs ffmpeg and uploads each chunk once the next one appears (the segment muxer has then
 * closed it). On stop, ffmpeg is interrupted gracefully and the final chunk is uploaded too.
 */
export class Recorder {
  private readonly spawnFn: SpawnFn;
  private readonly fs: FsLike;
  private readonly now: () => number;
  private readonly chunkMs: number;
  private child: ChildLike | null = null;
  private childExit: Promise<void> | null = null;
  private runs: Run[] = [];
  private enqueued = new Set<number>();
  private failed = new Map<number, ChunkInfo>();
  private uploaded = new Map<number, ChunkInfo>();
  private uploadChain: Promise<void> = Promise.resolve();
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private scanning: Promise<void> | null = null;
  private stopping = false;
  private restarts = 0;
  private _startedAt: number | null = null;

  constructor(private readonly opts: RecorderOptions) {
    this.spawnFn = opts.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] }));
    this.fs = opts.fs ?? {
      mkdir: (p, o) => nodeFs.mkdir(p, o),
      readdir: (p) => nodeFs.readdir(p),
      readFile: (p) => nodeFs.readFile(p),
    };
    this.now = opts.now ?? Date.now;
    this.chunkMs = opts.chunkSeconds * 1000;
  }

  get startedAt(): number | null {
    return this._startedAt;
  }

  get chunks(): ChunkInfo[] {
    return [...this.uploaded.values()].sort((a, b) => a.index - b.index);
  }

  async start(): Promise<void> {
    if (this._startedAt !== null) throw new Error("recorder already started");
    await this.fs.mkdir(this.opts.workDir, { recursive: true });
    this._startedAt = this.now();
    this.launch(0);
    this.watchTimer = setInterval(() => void this.scan(false), this.opts.watchIntervalMs ?? 1000);
  }

  private launch(startIndex: number): void {
    const startedAt = this._startedAt ?? this.now();
    const run: Run = {
      startIndex,
      offsetMs: this.now() - startedAt,
      listPath: path.join(this.opts.workDir, `segments_${this.runs.length}.csv`),
    };
    this.runs.push(run);
    const args = buildFfmpegArgs({
      pulseSink: this.opts.pulseSink,
      chunkSeconds: this.opts.chunkSeconds,
      workDir: this.opts.workDir,
      startNumber: startIndex,
      segmentListPath: run.listPath,
    });
    this.opts.logger.info({ startIndex, offsetMs: run.offsetMs }, "starting ffmpeg");
    const child = this.spawnFn(this.opts.ffmpegPath ?? "ffmpeg", args);
    this.child = child;
    child.stderr?.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) this.opts.logger.warn({ ffmpeg: msg.slice(0, 500) }, "ffmpeg stderr");
    });
    this.childExit = new Promise<void>((resolve) => {
      let done = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null, err?: Error) => {
        if (done) return;
        done = true;
        if (this.child === child) this.child = null;
        resolve();
        if (!this.stopping) void this.onUnexpectedExit(code, signal, err);
      };
      child.once("exit", (code, signal) => finish(code, signal));
      child.once("error", (err) => finish(null, null, err));
    });
  }

  private async onUnexpectedExit(code: number | null, signal: NodeJS.Signals | null, err?: Error): Promise<void> {
    this.opts.logger.error({ code, signal, err: err?.message }, "ffmpeg exited unexpectedly");
    await this.scan(true); // everything on disk is now complete
    if (this.stopping) return;
    const max = this.opts.maxRestarts ?? 5;
    if (this.restarts >= max) {
      this.opts.onFatal?.(new Error(`ffmpeg failed ${this.restarts + 1} times (last: code=${code} signal=${signal} ${err?.message ?? ""})`));
      return;
    }
    this.restarts++;
    await new Promise((r) => setTimeout(r, this.opts.restartDelayMs ?? 1000));
    if (this.stopping) return;
    const files = await this.listChunkIndexes();
    const next = Math.max(-1, ...files, ...this.enqueued) + 1;
    this.launch(next);
  }

  private async listChunkIndexes(): Promise<number[]> {
    let names: string[];
    try {
      names = await this.fs.readdir(this.opts.workDir);
    } catch {
      return [];
    }
    const out: number[] = [];
    for (const n of names) {
      const m = CHUNK_RE.exec(n);
      if (m?.[1]) out.push(Number(m[1]));
    }
    return out.sort((a, b) => a - b);
  }

  /** Enqueue uploads for complete chunks. `all` = ffmpeg is not running, so every chunk is complete. */
  scan(all: boolean): Promise<void> {
    const run = async () => {
      const indexes = await this.listChunkIndexes();
      if (indexes.length === 0) return;
      const max = indexes[indexes.length - 1]!;
      const complete = all ? indexes : indexes.filter((i) => i < max);
      const pending = complete.filter((i) => !this.enqueued.has(i));
      if (pending.length === 0) return;
      const lists = await this.readSegmentLists();
      for (const index of pending) {
        this.enqueued.add(index);
        this.enqueueUpload(this.describeChunk(index, lists, index === max));
      }
    };
    // Serialize scans so a chunk is never described twice concurrently.
    const p = (this.scanning ?? Promise.resolve()).then(run).catch((err) => {
      this.opts.logger.error({ err: (err as Error).message }, "chunk scan failed");
    });
    this.scanning = p;
    return p;
  }

  private async readSegmentLists(): Promise<Map<string, { start: number; end: number }>[]> {
    return Promise.all(
      this.runs.map(async (r) => {
        try {
          return parseSegmentList(Buffer.from(await this.fs.readFile(r.listPath)).toString("utf8"));
        } catch {
          return new Map<string, { start: number; end: number }>();
        }
      }),
    );
  }

  private describeChunk(index: number, lists: Map<string, { start: number; end: number }>[], isLast: boolean): ChunkInfo {
    let runIdx = 0;
    for (let i = 0; i < this.runs.length; i++) if (this.runs[i]!.startIndex <= index) runIdx = i;
    const run = this.runs[runIdx] ?? { startIndex: 0, offsetMs: 0 };
    const entry = lists[runIdx]?.get(chunkFileName(index));
    let start_ms: number;
    let duration_ms: number;
    if (entry) {
      start_ms = run.offsetMs + Math.round(entry.start * 1000);
      duration_ms = Math.round((entry.end - entry.start) * 1000);
    } else {
      start_ms = run.offsetMs + (index - run.startIndex) * this.chunkMs;
      const elapsed = this._startedAt === null ? this.chunkMs : this.now() - this._startedAt;
      duration_ms = isLast ? Math.max(0, Math.min(this.chunkMs, elapsed - start_ms)) : this.chunkMs;
    }
    return { index, blob: chunkBlobName(this.opts.uploadPrefix, index), start_ms, duration_ms };
  }

  private enqueueUpload(chunk: ChunkInfo): void {
    this.uploadChain = this.uploadChain.then(() => this.uploadOne(chunk));
  }

  private async uploadOne(chunk: ChunkInfo): Promise<void> {
    const file = path.join(this.opts.workDir, chunkFileName(chunk.index));
    let data: Uint8Array;
    try {
      data = await this.fs.readFile(file);
    } catch (err) {
      this.opts.logger.error({ err: (err as Error).message, index: chunk.index }, "cannot read chunk");
      return;
    }
    if (data.byteLength === 0) {
      this.opts.logger.warn({ index: chunk.index }, "skipping empty chunk");
      return;
    }
    try {
      await this.opts.upload(chunk, data);
      this.uploaded.set(chunk.index, chunk);
      this.failed.delete(chunk.index);
    } catch (err) {
      this.opts.logger.error({ err: (err as Error).message, index: chunk.index }, "chunk upload failed; will retry at stop");
      this.failed.set(chunk.index, chunk);
    }
  }

  /** Stop ffmpeg gracefully, upload the final chunk(s) and return the recording summary. */
  async stop(): Promise<RecordingResult> {
    const startedAt = this._startedAt ?? this.now();
    if (this._startedAt === null) return { startedAt, durationMs: 0, chunks: [] };
    this.stopping = true;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    const stoppedAt = this.now();
    const child = this.child;
    if (child && this.childExit) {
      child.kill("SIGINT"); // ffmpeg finalizes the current segment on SIGINT
      const timeoutMs = this.opts.stopTimeoutMs ?? 15_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const exited = await Promise.race([
        this.childExit.then(() => true),
        new Promise<boolean>((r) => (timer = setTimeout(() => r(false), timeoutMs))),
      ]);
      if (timer) clearTimeout(timer);
      if (!exited) {
        this.opts.logger.warn("ffmpeg did not exit after SIGINT; killing");
        child.kill("SIGKILL");
      }
    }
    await this.scan(true);
    await this.uploadChain;
    // One more attempt for anything that failed earlier.
    for (const chunk of [...this.failed.values()]) this.enqueueUpload(chunk);
    await this.uploadChain;
    const chunks = this.chunks;
    const lastEnd = chunks.reduce((m, c) => Math.max(m, c.start_ms + c.duration_ms), 0);
    const durationMs = lastEnd > 0 ? lastEnd : Math.max(0, stoppedAt - startedAt);
    return { startedAt, durationMs, chunks };
  }
}
