import { ConfigError, configFromEnv } from "./config.js";
import { createLogger } from "./logger.js";
import { runSession } from "./run-session.js";

async function main(): Promise<number> {
  const logger = createLogger({ mode: "single" });
  let config;
  try {
    config = configFromEnv();
  } catch (err) {
    logger.fatal({ err: (err as Error).message, issues: err instanceof ConfigError ? err.issues : undefined }, "invalid configuration");
    return 1;
  }
  const result = await runSession(config, logger, (session) => {
    const stop = () => session.requestStop("sigterm");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
  return result.outcome === "completed" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    createLogger().fatal({ err: String(err) }, "unhandled error");
    process.exit(1);
  },
);
