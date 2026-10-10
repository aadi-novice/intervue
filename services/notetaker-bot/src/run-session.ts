import { selectAdapter } from "./adapters/index.js";
import { BackendClient } from "./backend-client.js";
import { launchBrowser } from "./browser.js";
import type { SessionConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { Recorder } from "./recorder.js";
import { Session, type SessionResult } from "./session.js";

/** Wires real dependencies and runs one meeting. `onSession` exposes the session so callers can forward SIGTERM. */
export async function runSession(
  config: SessionConfig,
  baseLogger: Logger,
  onSession?: (s: Session) => void,
): Promise<SessionResult> {
  const logger = baseLogger.child({ sessionId: config.sessionId });
  const backend = new BackendClient({
    baseUrl: config.callbackUrl,
    sessionId: config.sessionId,
    secret: config.callbackSecret,
    logger,
  });
  const session = new Session({
    config,
    adapter: selectAdapter(config.meetingUrl),
    backend,
    logger,
    launchBrowser: () => launchBrowser({ headless: config.headless, pulseSink: config.pulseSink }),
    createRecorder: (hooks) =>
      new Recorder({
        workDir: config.workDir,
        pulseSink: config.pulseSink,
        chunkSeconds: config.chunkSeconds,
        uploadPrefix: config.uploadPrefix,
        ffmpegPath: config.ffmpegPath,
        logger,
        upload: hooks.upload,
        onFatal: hooks.onFatal,
      }),
  });
  onSession?.(session);
  return session.run();
}
