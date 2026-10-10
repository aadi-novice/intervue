import { pino, type Logger } from "pino";

export type { Logger };

/** Structured JSON logs on stdout. Secrets are redacted defensively. */
export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: "notetaker-bot", ...bindings },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ["callbackSecret", "callback_secret", "*.callbackSecret", "*.callback_secret", "headers.X-Signature", "url"],
      censor: "[redacted]",
    },
  });
}

/** A silent logger for tests. */
export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}
