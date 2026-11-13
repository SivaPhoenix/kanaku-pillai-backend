import dns from "node:dns";
import { createApp } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { ensureIndexes as ensureRateLimitIndexes } from "./repositories/rate-limit.repository.js";

let server;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  // If draining hangs (a stuck request or socket), exit anyway so the orchestrator can replace the instance.
  setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    }
    await disconnectDb();
    logger.info("Shutdown complete");
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
}

async function start() {
  // mongodb+srv:// needs an SRV lookup; on some Windows setups Node's resolver points at a local address that refuses it.
  if (env.DNS_SERVERS.length > 0) {
    dns.setServers(env.DNS_SERVERS);
    logger.info({ servers: env.DNS_SERVERS }, "Using configured DNS servers");
  }

  const isProduction = env.NODE_ENV === "production";
  await connectDb(env.MONGODB_URI, { autoIndex: !isProduction });
  // Mongoose builds model indexes itself outside production; the raw rate-limit collection needs this call. Production runs `npm run db:indexes` at deploy.
  if (!isProduction) await ensureRateLimitIndexes();

  server = createApp().listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, "API listening");
  });

  // Keep idle connections open longer than a typical load balancer's 60 s timeout, so it never reuses a socket the API has closed.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
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
  logger.fatal({ err: error }, "Failed to start");
  process.exit(1);
});
