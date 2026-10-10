import type { SpeakerEventPayload } from "./backend-client.js";

export interface SpeakerTrackerOptions {
  /** Delivers a batch; should not throw (BackendClient.sendEvent never does). */
  flush: (events: SpeakerEventPayload[]) => Promise<unknown>;
  maxBatch?: number;
  flushIntervalMs?: number;
}

/**
 * Dedupes consecutive identical speakers and batches events
 * (flush every `flushIntervalMs` or when `maxBatch` events are buffered).
 */
export class SpeakerTracker {
  private buffer: SpeakerEventPayload[] = [];
  private lastName: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<unknown> = Promise.resolve();
  private readonly maxBatch: number;
  private readonly flushIntervalMs: number;

  constructor(private readonly opts: SpeakerTrackerOptions) {
    this.maxBatch = opts.maxBatch ?? 200;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  /** Record a speaker observation. Returns true if it was a change (i.e. buffered). */
  observe(e: { tMs: number; name: string }): boolean {
    const name = e.name.trim();
    if (!name || name === this.lastName) return false;
    this.lastName = name;
    this.buffer.push({ t_ms: Math.max(0, Math.round(e.tMs)), name });
    if (this.buffer.length >= this.maxBatch) void this.flush();
    return true;
  }

  /** Forget the current speaker so the next observation is emitted even if it is the same person. */
  resetCurrent(): void {
    this.lastName = null;
  }

  flush(): Promise<unknown> {
    if (this.buffer.length === 0) return this.inflight;
    const batch = this.buffer;
    this.buffer = [];
    this.inflight = this.inflight.then(() => this.opts.flush(batch)).catch(() => undefined);
    return this.inflight;
  }

  /** Stop the interval and flush whatever is buffered. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  get pending(): number {
    return this.buffer.length;
  }
}
