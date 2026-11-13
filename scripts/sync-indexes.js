// Deploy step: builds every index (production runs with autoIndex off). Usage: npm run db:indexes
import dns from "node:dns";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { Session } from "../src/models/session.model.js";
import { User } from "../src/models/user.model.js";
import { ensureIndexes as ensureRateLimitIndexes } from "../src/repositories/rate-limit.repository.js";

const MODELS = [User, Session];

async function main() {
  if (env.DNS_SERVERS.length > 0) dns.setServers(env.DNS_SERVERS);
  await connectDb(env.MONGODB_URI, { autoIndex: false });
  for (const model of MODELS) {
    const dropped = await model.syncIndexes();
    logger.info({ model: model.modelName, dropped }, "Indexes synced");
  }
  await ensureRateLimitIndexes();
  logger.info("Rate-limit indexes ensured");
  await disconnectDb();
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "Index sync failed");
  await disconnectDb().catch(() => {});
  process.exit(1);
});
