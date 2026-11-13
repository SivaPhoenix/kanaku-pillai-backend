import dns from "node:dns";
import { connectDb, disconnectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { startScheduler } from "./jobs/scheduler.js";

let scheduler;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Worker shutting down");

  // If a job hangs, exit anyway so the orchestrator can replace the instance.
  setTimeout(() => {
    logger.error("Worker shutdown timed out, forcing exit");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();

  try {
    await scheduler?.stop();
    await disconnectDb();
    logger.info("Worker shutdown complete");
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, "Error during worker shutdown");
    process.exit(1);
  }
}

async function start() {
  if (env.DNS_SERVERS.length > 0) {
    dns.setServers(env.DNS_SERVERS);
    logger.info({ servers: env.DNS_SERVERS }, "Using configured DNS servers");
  }

  await connectDb(env.MONGODB_URI, { autoIndex: env.NODE_ENV !== "production" });
  scheduler = startScheduler();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});

start().catch((error) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
