import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** Accepts booleans or the usual env-string spellings. */
const boolish = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return v; // let zod reject it
}, z.boolean());

const positiveNumber = z.coerce.number().positive().finite();

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * Session configuration. Keys are lowercase snake_case so the same schema validates both
 * the container env (lower-cased) and PoolLauncher job payloads from Redis.
 */
export const sessionConfigSchema = z
  .object({
    bot_session_id: z.string().trim().min(1, "BOT_SESSION_ID is required"),
    meeting_url: z.url({ protocol: /^https?$/, error: "MEETING_URL must be an http(s) URL" }),
    bot_name: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).default("Intervue Notetaker")),
    // Consent can be re-worded but never disabled (spec §10).
    consent_message: z.string().trim().min(1, "CONSENT_MESSAGE is required and must be non-empty"),
    callback_url: z.url({ protocol: /^https?$/, error: "CALLBACK_URL must be an http(s) URL" }),
    callback_secret: z.string().min(1, "CALLBACK_SECRET is required"),
    upload_prefix: z.string().trim().min(1, "UPLOAD_PREFIX is required"),
    max_duration_min: z.preprocess(emptyToUndefined, positiveNumber.default(180)),
    admission_timeout_min: z.preprocess(emptyToUndefined, positiveNumber.default(10)),
    alone_timeout_sec: z.preprocess(emptyToUndefined, positiveNumber.default(120)),
    chunk_seconds: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(600).default(30)),
    pulse_sink: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("intervue_sink")),
    headless: z.preprocess(emptyToUndefined, boolish.default(false)),
    ffmpeg_path: z.preprocess(emptyToUndefined, z.string().min(1).default("ffmpeg")),
    work_dir: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .transform((c) => ({
    sessionId: c.bot_session_id,
    meetingUrl: c.meeting_url,
    botName: c.bot_name,
    consentMessage: c.consent_message,
    callbackUrl: c.callback_url.replace(/\/+$/, ""),
    callbackSecret: c.callback_secret,
    uploadPrefix: normalizePrefix(c.upload_prefix),
    maxDurationMs: Math.round(c.max_duration_min * 60_000),
    admissionTimeoutMs: Math.round(c.admission_timeout_min * 60_000),
    aloneTimeoutMs: Math.round(c.alone_timeout_sec * 1000),
    chunkSeconds: c.chunk_seconds,
    pulseSink: c.pulse_sink,
    headless: c.headless,
    ffmpegPath: c.ffmpeg_path,
    workDir: c.work_dir ?? path.join(os.tmpdir(), "intervue-bot", safeSegment(c.bot_session_id)),
  }));

export type SessionConfig = z.output<typeof sessionConfigSchema>;

/** Keys accepted from the environment / job payload (lowercase snake_case). */
export const CONFIG_KEYS = [
  "bot_session_id",
  "meeting_url",
  "bot_name",
  "consent_message",
  "callback_url",
  "callback_secret",
  "upload_prefix",
  "max_duration_min",
  "admission_timeout_min",
  "alone_timeout_sec",
  "chunk_seconds",
  "pulse_sink",
  "headless",
  "ffmpeg_path",
  "work_dir",
] as const;

/** Worker-level settings that a pool job may not carry; taken from the worker env. */
const WORKER_LEVEL_KEYS = ["chunk_seconds", "pulse_sink", "headless", "ffmpeg_path"] as const;

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

function normalizePrefix(prefix: string): string {
  let p = prefix.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p.endsWith("/")) p += "/";
  return p;
}

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) || "session";
}

export function parseSessionConfig(raw: Record<string, unknown>): SessionConfig {
  const result = sessionConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`Invalid bot configuration: ${issues.join("; ")}`, issues);
  }
  return result.data;
}

/** Reads `BOT_SESSION_ID`, `MEETING_URL`, ... from an env object. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SessionConfig {
  const raw: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    const v = env[key.toUpperCase()];
    if (v !== undefined) raw[key] = v;
  }
  return parseSessionConfig(raw);
}

/**
 * Builds a config for a PoolLauncher job: job keys win; worker-level settings
 * (chunk size, pulse sink, headless, ffmpeg path) fall back to the worker env.
 */
export function configFromJob(job: unknown, env: NodeJS.ProcessEnv = process.env): SessionConfig {
  if (typeof job !== "object" || job === null || Array.isArray(job)) {
    throw new ConfigError("Invalid bot job: expected a JSON object", ["(root): expected object"]);
  }
  const src = job as Record<string, unknown>;
  const raw: Record<string, unknown> = {};
  for (const key of WORKER_LEVEL_KEYS) {
    const v = env[key.toUpperCase()];
    if (v !== undefined) raw[key] = v;
  }
  for (const key of CONFIG_KEYS) {
    if (key === "work_dir") continue; // never let a job choose a filesystem path
    if (src[key] !== undefined) raw[key] = src[key];
  }
  return parseSessionConfig(raw);
}
