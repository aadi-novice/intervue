import { createHmac } from "node:crypto";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Contract types (bot -> backend). Keep in sync with backend /internal/bots/*.
// ---------------------------------------------------------------------------

export type BotStatus = "joining" | "waiting_admission" | "in_call" | "leaving";

export type FailureReason =
  | "admission_timeout"
  | "blocked_by_host"
  | "guests_not_allowed"
  | "meeting_not_found"
  | "ui_changed"
  | "crash";

export interface SpeakerEventPayload {
  t_ms: number;
  name: string;
}

export type BotEvent =
  | { type: "status"; status: BotStatus; at: string }
  | { type: "consent_sent"; at: string }
  | { type: "speaker_events"; events: SpeakerEventPayload[] }
  | { type: "chunk_uploaded"; index: number; blob: string; start_ms: number; duration_ms: number }
  | { type: "completed"; manifest_blob: string; duration_ms: number }
  | { type: "failed"; reason: FailureReason; detail: string; screenshot_blob: string | null };

export type ControlAction = "none" | "stop";

export interface UploadUrlResponse {
  url: string;
  headers: Record<string, string>;
}

/** The subset of the client the session/recorder depend on (lets tests fake it). */
export interface Backend {
  sendEvent(event: BotEvent): Promise<boolean>;
  uploadBlob(blob: string, data: Uint8Array, contentType: string, opts?: { attempts?: number }): Promise<void>;
  getControl(): Promise<ControlAction>;
  drain(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Signing + backoff (pure, unit-tested)
// ---------------------------------------------------------------------------

/** hex(hmac_sha256(secret, "<timestamp>." + rawBody)) */
export function signPayload(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function signedHeaders(secret: string, rawBody: string, nowMs: number): Record<string, string> {
  const ts = Math.floor(nowMs / 1000).toString();
  return {
    "Content-Type": "application/json",
    "X-Timestamp": ts,
    "X-Signature": signPayload(secret, ts, rawBody),
  };
}

/**
 * Exponential backoff with "equal jitter": attempt 1 -> ~base, 2 -> ~2*base, ... capped at maxMs.
 * `random` is injectable so tests are deterministic.
 */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 15_000, random: () => number = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + (exp / 2) * random());
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Network errors, timeouts, 408, 429 and 5xx are retryable; other 4xx are not. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return true;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface BackendClientOptions {
  baseUrl: string;
  sessionId: string;
  secret: string;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  requestTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BackendClient implements Backend {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly base: string;
  /** Events are sent strictly in order through one queue. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: BackendClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 15_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
    this.base = `${opts.baseUrl.replace(/\/+$/, "")}/internal/bots/${encodeURIComponent(opts.sessionId)}`;
  }

  /** Signed JSON request with retries. Throws the last error after `attempts`. */
  async request<T>(method: "GET" | "POST", path: string, body?: unknown, attempts = this.maxAttempts): Promise<T> {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          // Re-sign every attempt so the timestamp stays fresh.
          headers: signedHeaders(this.opts.secret, rawBody, this.now()),
          body: method === "GET" ? undefined : rawBody,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpError(res.status, `${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
        }
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      } catch (err) {
        lastErr = err;
        const retry = attempt < attempts && isRetryable(err);
        this.opts.logger.warn(
          { err: errMessage(err), method, path, attempt, attempts, willRetry: retry },
          "backend request failed",
        );
        if (!retry) break;
        await this.sleep(backoffDelay(attempt, this.baseDelayMs, this.maxDelayMs, this.random));
      }
    }
    throw lastErr;
  }

  /**
   * Enqueue an event (sent in order). Never throws: resolves `false` if it could not be
   * delivered after retries, so a callback failure never kills the session.
   */
  sendEvent(event: BotEvent): Promise<boolean> {
    const p = this.queue.then(async () => {
      try {
        await this.request("POST", "/events", event);
        this.opts.logger.debug({ eventType: event.type }, "event sent");
        return true;
      } catch (err) {
        this.opts.logger.error({ err: errMessage(err), eventType: event.type }, "event delivery failed; continuing");
        return false;
      }
    });
    this.queue = p;
    return p;
  }

  /** Wait for all queued events to be delivered (or given up on). */
  async drain(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  async getUploadUrl(blob: string, contentType: string, attempts = this.maxAttempts): Promise<UploadUrlResponse> {
    const res = await this.request<UploadUrlResponse>("POST", "/upload-url", { blob, content_type: contentType }, attempts);
    if (!res || typeof res.url !== "string" || !res.url) throw new Error("upload-url response missing url");
    return { url: res.url, headers: res.headers ?? { "Content-Type": contentType } };
  }

  /** Get a presigned URL from the backend and PUT the bytes. Throws after `attempts`. */
  async uploadBlob(blob: string, data: Uint8Array, contentType: string, opts: { attempts?: number } = {}): Promise<void> {
    const attempts = opts.attempts ?? this.maxAttempts;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // A fresh presigned URL per attempt (they are short-lived).
        const { url, headers } = await this.getUploadUrl(blob, contentType, 1);
        const res = await this.fetchImpl(url, {
          method: "PUT",
          headers,
          body: data as unknown as BodyInit,
          signal: AbortSignal.timeout(Math.max(this.requestTimeoutMs, 60_000)),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpError(res.status, `PUT blob -> ${res.status} ${text.slice(0, 200)}`);
        }
        this.opts.logger.info({ blob, bytes: data.byteLength }, "blob uploaded");
        return;
      } catch (err) {
        lastErr = err;
        const retry = attempt < attempts && isRetryable(err);
        this.opts.logger.warn({ err: errMessage(err), blob, attempt, attempts, willRetry: retry }, "blob upload failed");
        if (!retry) break;
        await this.sleep(backoffDelay(attempt, this.baseDelayMs, this.maxDelayMs, this.random));
      }
    }
    throw lastErr;
  }

  /** Poll the control endpoint once. Never throws; returns "none" if unreachable. */
  async getControl(): Promise<ControlAction> {
    try {
      const res = await this.request<{ action?: string }>("GET", "/control", undefined, 1);
      return res?.action === "stop" ? "stop" : "none";
    } catch {
      return "none";
    }
  }
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
