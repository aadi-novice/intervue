import type { Page } from "playwright";
import { AdapterError, type MeetingAdapter } from "./adapters/types.js";
import { errMessage, type Backend, type BotStatus, type FailureReason } from "./backend-client.js";
import type { LaunchedBrowser } from "./browser.js";
import type { SessionConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { AUDIO_MIME_TYPE, type ChunkInfo, type RecordingResult } from "./recorder.js";
import { SpeakerTracker } from "./speaker-tracker.js";

export type LeaveReason = "meeting_ended" | "alone" | "max_duration" | "backend_stop" | "sigterm" | "page_unavailable";

export type SessionResult =
  | { outcome: "completed"; leaveReason: LeaveReason; durationMs: number; chunks: number }
  | { outcome: "failed"; reason: FailureReason; detail: string };

export interface RecorderLike {
  readonly startedAt: number | null;
  start(): Promise<void>;
  stop(): Promise<RecordingResult>;
}

export interface RecorderHooks {
  upload: (chunk: ChunkInfo, data: Uint8Array) => Promise<void>;
  onFatal: (err: Error) => void;
}

export interface SessionTiming {
  /** How often leave conditions are checked. */
  monitorIntervalMs: number;
  /** Control endpoint poll interval (contract: 5 s). */
  controlPollMs: number;
  /** Initial admission probe; if not admitted by then we report `waiting_admission`. */
  lobbyProbeMs: number;
  /** Consent must be posted within this window after admission (spec: 10 s). */
  consentWindowMs: number;
  leaveTimeoutMs: number;
  navigationTimeoutMs: number;
  speakerFlushMs: number;
  speakerMaxBatch: number;
  manifestUploadAttempts: number;
  maxConsecutiveMonitorErrors: number;
}

export const DEFAULT_TIMING: SessionTiming = {
  monitorIntervalMs: 1000,
  controlPollMs: 5000,
  lobbyProbeMs: 3000,
  consentWindowMs: 10_000,
  leaveTimeoutMs: 15_000,
  navigationTimeoutMs: 60_000,
  speakerFlushMs: 5000,
  speakerMaxBatch: 200,
  manifestUploadAttempts: 10,
  maxConsecutiveMonitorErrors: 10,
};

export interface SessionDeps {
  config: SessionConfig;
  adapter: MeetingAdapter | null;
  backend: Backend;
  logger: Logger;
  launchBrowser: () => Promise<LaunchedBrowser>;
  createRecorder: (hooks: RecorderHooks) => RecorderLike;
  timing?: Partial<SessionTiming>;
  now?: () => number;
}

export interface Manifest {
  session_id: string;
  recording_started_at: string;
  duration_ms: number;
  chunks: ChunkInfo[];
  mime_type: typeof AUDIO_MIME_TYPE;
}

/** Thrown internally to abort the in-call phase with a failure. */
class SessionFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => timer && clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

/** Forces English UI so text selectors match. */
export function withEnglishUi(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("hl")) u.searchParams.set("hl", "en");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * One meeting, start to finish:
 * joining -> (waiting_admission) -> in_call -> consent -> record + observe -> leaving -> completed | failed.
 */
export class Session {
  private readonly t: SessionTiming;
  private readonly now: () => number;
  private readonly log: Logger;
  private stopReason: LeaveReason | null = null;
  private wakers = new Set<() => void>();
  private stopPromise: Promise<void>;
  private resolveStop!: () => void;
  private fatal: Error | null = null;
  private browser: LaunchedBrowser | null = null;
  private recorder: RecorderLike | null = null;
  private tracker: SpeakerTracker | null = null;
  private stopObserving: (() => void) | null = null;
  private controlTimer: ReturnType<typeof setTimeout> | null = null;
  private controlStopped = false;
  private finished = false;

  constructor(private readonly deps: SessionDeps) {
    this.t = { ...DEFAULT_TIMING, ...deps.timing };
    this.now = deps.now ?? Date.now;
    this.log = deps.logger;
    this.stopPromise = new Promise<void>((r) => (this.resolveStop = r));
  }

  /** Request a graceful leave (SIGTERM, backend stop). Safe to call multiple times. */
  requestStop(reason: LeaveReason): void {
    if (this.stopReason) return;
    this.log.info({ reason }, "stop requested");
    this.stopReason = reason;
    this.resolveStop();
    for (const wake of this.wakers) wake();
  }

  get stopRequested(): LeaveReason | null {
    return this.stopReason;
  }

  async run(): Promise<SessionResult> {
    this.startControlPolling();
    let result: SessionResult;
    try {
      result = await this.runInner();
    } catch (err) {
      const reason: FailureReason =
        err instanceof AdapterError || err instanceof SessionFailure ? err.reason : "crash";
      this.log.error({ err: errMessage(err), stack: (err as Error)?.stack, reason }, "session failed");
      result = await this.fail(reason, errMessage(err));
    } finally {
      this.stopControlPolling();
    }
    await this.deps.backend.drain();
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.log.info({ result }, "session finished");
    return result;
  }

  // -------------------------------------------------------------------------

  private async runInner(): Promise<SessionResult> {
    const { config, adapter } = this.deps;
    if (!adapter) {
      throw new SessionFailure("meeting_not_found", `unsupported meeting platform: ${new URL(config.meetingUrl).hostname}`);
    }
    this.status("joining");
    this.browser = await this.deps.launchBrowser();
    const page = this.browser.page;

    await page.goto(withEnglishUi(config.meetingUrl), {
      waitUntil: "domcontentloaded",
      timeout: this.t.navigationTimeoutMs,
    });
    if (this.stopReason) return this.finishWithoutRecording(page, this.stopReason);

    await adapter.join(page, { botName: config.botName });
    this.log.info("join requested");

    // --- Admission --------------------------------------------------------
    const admissionDeadline = this.now() + config.admissionTimeoutMs;
    let admission = await this.raceStop(
      adapter.waitForAdmission(page, Math.min(this.t.lobbyProbeMs, config.admissionTimeoutMs)),
    );
    if (admission === "timeout" && this.now() < admissionDeadline) {
      this.status("waiting_admission");
      admission = await this.raceStop(adapter.waitForAdmission(page, Math.max(0, admissionDeadline - this.now())));
    }
    if (admission === "stopped") return this.finishWithoutRecording(page, this.stopReason ?? "sigterm");
    if (admission === "denied") throw new SessionFailure("blocked_by_host", "the host denied the join request or removed the bot");
    if (admission === "timeout") {
      throw new SessionFailure("admission_timeout", `not admitted within ${Math.round(config.admissionTimeoutMs / 1000)} s`);
    }

    const admittedAt = this.now();
    this.status("in_call");
    this.log.info("admitted");

    // --- Consent (must succeed before we record anything) ------------------
    await this.postConsent(page, admittedAt);

    // --- Recording + speakers ---------------------------------------------
    this.tracker = new SpeakerTracker({
      flush: (events) => this.deps.backend.sendEvent({ type: "speaker_events", events }),
      flushIntervalMs: this.t.speakerFlushMs,
      maxBatch: this.t.speakerMaxBatch,
    });
    this.recorder = this.deps.createRecorder({
      upload: async (chunk, data) => {
        await this.deps.backend.uploadBlob(chunk.blob, data, AUDIO_MIME_TYPE);
        void this.deps.backend.sendEvent({ type: "chunk_uploaded", ...chunk });
      },
      onFatal: (err) => {
        this.fatal = err;
        for (const wake of this.wakers) wake();
      },
    });
    await this.recorder.start();
    const recordingStartedAt = this.recorder.startedAt ?? this.now();
    this.tracker.start();
    const tracker = this.tracker;
    const observeOffset = this.now() - recordingStartedAt;
    this.stopObserving = await adapter.observeActiveSpeakers(page, (e) =>
      tracker.observe({ tMs: e.tMs + observeOffset, name: e.name }),
    );
    this.log.info({ recordingStartedAt: iso(recordingStartedAt) }, "recording");

    const leaveReason = await this.monitor(page, adapter, recordingStartedAt);
    this.log.info({ leaveReason }, "leaving");
    return this.finish(page, adapter, leaveReason);
  }

  private async postConsent(page: Page, admittedAt: number): Promise<void> {
    const adapter = this.deps.adapter!;
    const deadline = admittedAt + this.t.consentWindowMs;
    let lastErr: unknown = new Error("consent window elapsed");
    let attempts = 0;
    while (this.now() < deadline || attempts === 0) {
      attempts++;
      try {
        await withTimeout(
          adapter.sendChatMessage(page, this.deps.config.consentMessage),
          Math.max(1000, deadline - this.now()),
          "sendChatMessage",
        );
        void this.deps.backend.sendEvent({ type: "consent_sent", at: iso(this.now()) });
        this.log.info({ attempts }, "consent message posted");
        return;
      } catch (err) {
        lastErr = err;
        this.log.warn({ err: errMessage(err), attempt: attempts }, "posting consent message failed");
        if (this.now() >= deadline) break;
        await this.waitOrStop(Math.min(1000, Math.max(0, deadline - this.now())));
      }
    }
    // Never record without having announced it.
    throw new SessionFailure("ui_changed", `could not post the consent message in chat: ${errMessage(lastErr)}`);
  }

  private async monitor(page: Page, adapter: MeetingAdapter, recordingStartedAt: number): Promise<LeaveReason> {
    const { config } = this.deps;
    let aloneSince: number | null = null;
    let consecutiveErrors = 0;
    for (;;) {
      if (this.fatal) throw new SessionFailure("crash", `recorder failed: ${this.fatal.message}`);
      if (this.stopReason) return this.stopReason;
      const now = this.now();
      if (now - recordingStartedAt >= config.maxDurationMs) return "max_duration";

      try {
        if (await adapter.isMeetingEnded(page)) return "meeting_ended";
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        this.log.warn({ err: errMessage(err), consecutiveErrors }, "isMeetingEnded failed");
        if (consecutiveErrors >= this.t.maxConsecutiveMonitorErrors) return "page_unavailable";
      }

      try {
        const count = await adapter.participantCount(page);
        if (Number.isFinite(count) && count <= 1) {
          aloneSince ??= this.now();
          if (this.now() - aloneSince >= config.aloneTimeoutMs) return "alone";
        } else if (Number.isFinite(count)) {
          aloneSince = null;
        }
      } catch (err) {
        // Unknown count: leave the alone timer as is.
        this.log.debug({ err: errMessage(err) }, "participantCount failed");
      }

      if (this.stopReason) return this.stopReason;
      await this.waitOrStop(this.t.monitorIntervalMs);
    }
  }

  private async finish(page: Page, adapter: MeetingAdapter, leaveReason: LeaveReason): Promise<SessionResult> {
    this.status("leaving");
    await this.stopObservers();
    await withTimeout(adapter.leave(page), this.t.leaveTimeoutMs, "leave").catch((err) =>
      this.log.warn({ err: errMessage(err) }, "leave failed (continuing)"),
    );
    const rec = await this.recorder!.stop();
    const manifestBlob = await this.uploadManifest(rec, this.t.manifestUploadAttempts);
    if (!manifestBlob) {
      throw new SessionFailure("crash", "could not upload the recording manifest");
    }
    this.finished = true;
    await this.deps.backend.sendEvent({ type: "completed", manifest_blob: manifestBlob, duration_ms: rec.durationMs });
    return { outcome: "completed", leaveReason, durationMs: rec.durationMs, chunks: rec.chunks.length };
  }

  /** Stopped (SIGTERM / backend) before we were admitted: nothing recorded. */
  private async finishWithoutRecording(page: Page, leaveReason: LeaveReason): Promise<SessionResult> {
    this.status("leaving");
    await withTimeout(this.deps.adapter!.leave(page), this.t.leaveTimeoutMs, "leave").catch(() => undefined);
    const now = this.now();
    const rec: RecordingResult = { startedAt: now, durationMs: 0, chunks: [] };
    const manifestBlob = await this.uploadManifest(rec, this.t.manifestUploadAttempts);
    if (!manifestBlob) throw new SessionFailure("crash", "could not upload the recording manifest");
    this.finished = true;
    await this.deps.backend.sendEvent({ type: "completed", manifest_blob: manifestBlob, duration_ms: 0 });
    return { outcome: "completed", leaveReason, durationMs: 0, chunks: 0 };
  }

  private async uploadManifest(rec: RecordingResult, attempts: number): Promise<string | null> {
    const manifest: Manifest = {
      session_id: this.deps.config.sessionId,
      recording_started_at: iso(rec.startedAt),
      duration_ms: rec.durationMs,
      chunks: rec.chunks.map((c) => ({ index: c.index, blob: c.blob, start_ms: c.start_ms, duration_ms: c.duration_ms })),
      mime_type: AUDIO_MIME_TYPE,
    };
    const blob = `${this.deps.config.uploadPrefix}manifest.json`;
    try {
      await this.deps.backend.uploadBlob(blob, Buffer.from(JSON.stringify(manifest), "utf8"), "application/json", { attempts });
      return blob;
    } catch (err) {
      this.log.error({ err: errMessage(err), blob }, "manifest upload failed");
      return null;
    }
  }

  private async fail(reason: FailureReason, detail: string): Promise<SessionResult> {
    if (this.finished) return { outcome: "failed", reason, detail };
    this.finished = true;
    const page = this.browser?.page;
    let screenshotBlob: string | null = null;
    if (page && !page.isClosed()) {
      try {
        const png = await withTimeout(page.screenshot({ type: "png" }), 10_000, "screenshot");
        const blob = `${this.deps.config.uploadPrefix}failure.png`;
        await this.deps.backend.uploadBlob(blob, png, "image/png", { attempts: 3 });
        screenshotBlob = blob;
      } catch (err) {
        this.log.warn({ err: errMessage(err) }, "failure screenshot not uploaded");
      }
    }
    // Salvage whatever audio we have so it is not lost.
    if (this.recorder) {
      await this.stopObservers().catch(() => undefined);
      try {
        const rec = await this.recorder.stop();
        await this.uploadManifest(rec, 3);
      } catch (err) {
        this.log.warn({ err: errMessage(err) }, "could not finalize recording after failure");
      }
    }
    if (page && !page.isClosed() && this.deps.adapter) {
      await withTimeout(this.deps.adapter.leave(page), 5000, "leave").catch(() => undefined);
    }
    await this.deps.backend.sendEvent({ type: "failed", reason, detail: detail.slice(0, 1000), screenshot_blob: screenshotBlob });
    return { outcome: "failed", reason, detail };
  }

  private async stopObservers(): Promise<void> {
    if (this.stopObserving) {
      this.stopObserving();
      this.stopObserving = null;
    }
    if (this.tracker) {
      await this.tracker.stop();
      this.tracker = null;
    }
  }

  // -------------------------------------------------------------------------

  private status(status: BotStatus): void {
    this.log.info({ status }, "status");
    void this.deps.backend.sendEvent({ type: "status", status, at: iso(this.now()) });
  }

  private async raceStop<T>(p: Promise<T>): Promise<T | "stopped"> {
    if (this.stopReason) return "stopped";
    return Promise.race([p, this.stopPromise.then(() => "stopped" as const)]);
  }

  /** Sleep that wakes early on stop / fatal recorder error. */
  private waitOrStop(ms: number): Promise<void> {
    if (this.stopReason || this.fatal) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  private startControlPolling(): void {
    const poll = async () => {
      if (this.controlStopped) return;
      const action = await this.deps.backend.getControl();
      if (action === "stop") this.requestStop("backend_stop");
      if (!this.controlStopped) this.controlTimer = setTimeout(() => void poll(), this.t.controlPollMs);
    };
    this.controlTimer = setTimeout(() => void poll(), this.t.controlPollMs);
  }

  private stopControlPolling(): void {
    this.controlStopped = true;
    if (this.controlTimer) clearTimeout(this.controlTimer);
    this.controlTimer = null;
  }
}
