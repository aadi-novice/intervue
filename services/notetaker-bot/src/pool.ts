import { Redis } from "ioredis";
import { configFromJob } from "./config.js";
import { createLogger } from "./logger.js";
import { runSession } from "./run-session.js";
import type { Session } from "./session.js";

const logger = createLogger({ mode: "pool" });
const queue = process.env.BOT_QUEUE_NAME || "intervue:bot_sessions";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  logger.fatal("REDIS_URL is required in pool mode");
  process.exit(1);
}

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
redis.on("error", (err) => logger.error({ err: err.message }, "redis error"));

let shuttingDown = false;
let current: Session | null = null;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown requested");
  if (current) current.requestStop("sigterm");
  else redis.disconnect();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function loop(): Promise<void> {
  logger.info({ queue }, "pool worker started");
  while (!shuttingDown) {
    let item: [string, string] | null;
    try {
      item = await redis.blpop(queue, 5);
    } catch (err) {
      if (shuttingDown) break;
      logger.error({ err: (err as Error).message }, "BLPOP failed; retrying");
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!item) continue;
    try {
      const config = configFromJob(JSON.parse(item[1]));
      logger.info({ sessionId: config.sessionId }, "picked up session");
      const result = await runSession(config, logger, (s) => (current = s));
      logger.info({ sessionId: config.sessionId, outcome: result.outcome }, "session done");
    } catch (err) {
      // Bad payloads / unexpected crashes must not kill the worker.
      logger.error({ err: (err as Error).message }, "job failed");
    } finally {
      current = null;
    }
  }
  redis.disconnect();
}

loop().then(
  () => process.exit(0),
  (err) => {
    logger.fatal({ err: String(err) }, "pool loop crashed");
    process.exit(1);
  },
);
