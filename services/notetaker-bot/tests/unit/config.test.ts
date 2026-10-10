import { describe, expect, it } from "vitest";
import { ConfigError, configFromEnv, configFromJob } from "../../src/config.js";

const base = {
  BOT_SESSION_ID: "abc",
  MEETING_URL: "https://meet.google.com/abc-defg-hij",
  CONSENT_MESSAGE: "This meeting is being recorded.",
  CALLBACK_URL: "http://backend:8000/",
  CALLBACK_SECRET: "s",
  UPLOAD_PREFIX: "recordings/abc",
};

describe("config", () => {
  it("applies defaults", () => {
    const c = configFromEnv(base);
    expect(c.botName).toBe("Intervue Notetaker");
    expect(c.maxDurationMs).toBe(180 * 60_000);
    expect(c.admissionTimeoutMs).toBe(10 * 60_000);
    expect(c.aloneTimeoutMs).toBe(120_000);
    expect(c.chunkSeconds).toBe(30);
    expect(c.pulseSink).toBe("intervue_sink");
    expect(c.headless).toBe(false);
    expect(c.callbackUrl).toBe("http://backend:8000");
    expect(c.uploadPrefix).toBe("recordings/abc/");
  });
  it("rejects an empty consent message (consent cannot be disabled)", () => {
    expect(() => configFromEnv({ ...base, CONSENT_MESSAGE: "   " })).toThrow(ConfigError);
    const { CONSENT_MESSAGE: _omit, ...rest } = base;
    expect(() => configFromEnv(rest)).toThrow(ConfigError);
  });
  it("rejects bad urls and numbers", () => {
    expect(() => configFromEnv({ ...base, MEETING_URL: "nope" })).toThrow(ConfigError);
    expect(() => configFromEnv({ ...base, MAX_DURATION_MIN: "-1" })).toThrow(ConfigError);
  });
  it("parses pool jobs in snake_case and ignores work_dir", () => {
    const c = configFromJob(
      {
        bot_session_id: "j1",
        meeting_url: "https://meet.google.com/x",
        consent_message: "hi",
        callback_url: "http://b",
        callback_secret: "s",
        upload_prefix: "recordings/j1/",
        max_duration_min: 5,
        work_dir: "/etc",
      },
      { HEADLESS: "true" },
    );
    expect(c.maxDurationMs).toBe(300_000);
    expect(c.headless).toBe(true);
    expect(c.workDir).not.toBe("/etc");
  });
  it("rejects non-object jobs", () => {
    expect(() => configFromJob("x")).toThrow(ConfigError);
  });
});
