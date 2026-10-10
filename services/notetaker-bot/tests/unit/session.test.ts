import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterError, type MeetingAdapter } from "../../src/adapters/types.js";
import type { Backend, BotEvent, ControlAction } from "../../src/backend-client.js";
import { configFromEnv } from "../../src/config.js";
import { createSilentLogger } from "../../src/logger.js";
import { Session, type RecorderLike, type SessionResult } from "../../src/session.js";

const env = {
  BOT_SESSION_ID: "s1",
  MEETING_URL: "https://meet.google.com/abc-defg-hij",
  CONSENT_MESSAGE: "This meeting is being recorded by Intervue.",
  CALLBACK_URL: "http://backend:8000",
  CALLBACK_SECRET: "k",
  UPLOAD_PREFIX: "recordings/s1/",
  ALONE_TIMEOUT_SEC: "5",
  MAX_DURATION_MIN: "1",
  ADMISSION_TIMEOUT_MIN: "1",
};

interface Fakes {
  events: BotEvent[];
  uploads: { blob: string; contentType: string; body: string }[];
  control: { action: ControlAction };
  adapter: MeetingAdapter & { calls: string[]; count: number; ended: boolean; admission: string; chatFails: boolean };
  recorderStopped: boolean;
  session: Session;
  run: () => Promise<SessionResult>;
}

function build(envOver: Record<string, string> = {}): Fakes {
  const events: BotEvent[] = [];
  const uploads: Fakes["uploads"] = [];
  const control = { action: "none" as ControlAction };
  const backend: Backend = {
    sendEvent: async (e) => {
      events.push(e);
      return true;
    },
    uploadBlob: async (blob, data, contentType) => {
      uploads.push({ blob, contentType, body: contentType === "image/png" ? "" : Buffer.from(data).toString() });
    },
    getControl: async () => control.action,
    drain: async () => undefined,
  };
  const adapter = {
    platform: "google_meet",
    calls: [] as string[],
    count: 3,
    ended: false,
    admission: "admitted",
    chatFails: false,
    matches: () => true,
    async join() {
      adapter.calls.push("join");
    },
    async waitForAdmission() {
      return adapter.admission as "admitted" | "denied" | "timeout";
    },
    async sendChatMessage() {
      if (adapter.chatFails) throw new Error("no chat");
      adapter.calls.push("chat");
    },
    async observeActiveSpeakers(_p: unknown, on: (e: { tMs: number; name: string }) => void) {
      on({ tMs: 100, name: "Priya Sharma" });
      return () => adapter.calls.push("stopObserving");
    },
    async participantCount() {
      return adapter.count;
    },
    async isMeetingEnded() {
      return adapter.ended;
    },
    async leave() {
      adapter.calls.push("leave");
    },
  } as unknown as Fakes["adapter"];

  const state = { stopped: false };
  const recorder: RecorderLike = {
    startedAt: null,
    async start() {
      (recorder as { startedAt: number | null }).startedAt = Date.now();
    },
    async stop() {
      state.stopped = true;
      return {
        startedAt: recorder.startedAt ?? Date.now(),
        durationMs: 1234,
        chunks: [{ index: 0, blob: "recordings/s1/0000.opus", start_ms: 0, duration_ms: 1234 }],
      };
    },
  };
  const page = {
    goto: async () => undefined,
    isClosed: () => false,
    screenshot: async () => Buffer.from("png"),
  };
  const session = new Session({
    config: configFromEnv({ ...env, ...envOver }),
    adapter,
    backend,
    logger: createSilentLogger(),
    launchBrowser: async () => ({ page: page as never, close: async () => undefined }),
    createRecorder: () => recorder,
    timing: { controlPollMs: 5000 },
  });
  return {
    events,
    uploads,
    control,
    adapter,
    session,
    get recorderStopped() {
      return state.stopped;
    },
    run: () => session.run(),
  } as Fakes;
}

const types = (f: Fakes) => f.events.map((e) => (e.type === "status" ? `status:${e.status}` : e.type));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Session", () => {
  it("leaves when alone for ALONE_TIMEOUT_SEC, then uploads the manifest and completes", async () => {
    const f = build();
    f.adapter.count = 1;
    const p = f.run();
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.session.stopRequested).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p;
    expect(r).toMatchObject({ outcome: "completed", leaveReason: "alone" });
    expect(types(f)).toEqual(["status:joining", "status:in_call", "consent_sent", "speaker_events", "status:leaving", "completed"]);
    expect(f.adapter.calls).toEqual(expect.arrayContaining(["join", "chat", "leave"]));
    const manifest = f.uploads.find((u) => u.blob === "recordings/s1/manifest.json")!;
    expect(manifest.contentType).toBe("application/json");
    const m = JSON.parse(manifest.body);
    expect(m).toMatchObject({ session_id: "s1", duration_ms: 1234, mime_type: "audio/ogg" });
    expect(m.chunks).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ type: "completed", manifest_blob: "recordings/s1/manifest.json", duration_ms: 1234 });
  });

  it("does not leave while others are present, and resets the alone timer", async () => {
    const f = build();
    f.adapter.count = 1;
    const p = f.run();
    await vi.advanceTimersByTimeAsync(3000);
    f.adapter.count = 2;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.session.stopRequested).toBeNull();
    f.adapter.ended = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toMatchObject({ leaveReason: "meeting_ended" });
  });

  it("leaves at MAX_DURATION_MIN", async () => {
    const f = build();
    const p = f.run();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.session.stopRequested).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toMatchObject({ outcome: "completed", leaveReason: "max_duration" });
  });

  it("leaves when the backend control endpoint says stop (polled every 5 s)", async () => {
    const f = build();
    const p = f.run();
    await vi.advanceTimersByTimeAsync(1000);
    f.control.action = "stop";
    await vi.advanceTimersByTimeAsync(6000);
    expect(await p).toMatchObject({ outcome: "completed", leaveReason: "backend_stop" });
  });

  it("leaves on SIGTERM-style stop request", async () => {
    const f = build();
    const p = f.run();
    await vi.advanceTimersByTimeAsync(1500);
    f.session.requestStop("sigterm");
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toMatchObject({ outcome: "completed", leaveReason: "sigterm" });
    expect(f.recorderStopped).toBe(true);
  });

  it("fails with blocked_by_host when denied, with a screenshot", async () => {
    const f = build();
    f.adapter.admission = "denied";
    const r = await f.run();
    expect(r).toMatchObject({ outcome: "failed", reason: "blocked_by_host" });
    expect(f.events.at(-1)).toMatchObject({ type: "failed", reason: "blocked_by_host", screenshot_blob: "recordings/s1/failure.png" });
    expect(f.uploads.some((u) => u.blob === "recordings/s1/failure.png")).toBe(true);
  });

  it("reports waiting_admission then admission_timeout", async () => {
    const f = build();
    f.adapter.admission = "timeout";
    const r = await f.run();
    expect(r).toMatchObject({ outcome: "failed", reason: "admission_timeout" });
    expect(types(f)).toEqual(["status:joining", "status:waiting_admission", "failed"]);
  });

  it("maps AdapterError reasons from join()", async () => {
    const f = build();
    f.adapter.join = async () => {
      throw new AdapterError("guests_not_allowed", "nope");
    };
    const r = await f.run();
    expect(r).toMatchObject({ outcome: "failed", reason: "guests_not_allowed" });
  });

  it("never records if the consent message cannot be posted", async () => {
    const f = build();
    f.adapter.chatFails = true;
    const p = f.run();
    await vi.advanceTimersByTimeAsync(15_000);
    const r = await p;
    expect(r).toMatchObject({ outcome: "failed", reason: "ui_changed" });
    expect(f.recorderStopped).toBe(false);
    expect(types(f)).not.toContain("consent_sent");
  });

  it("maps unexpected errors to crash", async () => {
    const f = build();
    f.adapter.join = async () => {
      throw new Error("boom");
    };
    expect(await f.run()).toMatchObject({ outcome: "failed", reason: "crash" });
  });
});
