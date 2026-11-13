// Deploy step: builds every index (production runs with autoIndex off). Usage: npm run db:indexes
import dns from "node:dns";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { Account } from "../src/models/account.model.js";
import { Category } from "../src/models/category.model.js";
import { Favourite } from "../src/models/favourite.model.js";
import { IdempotencyKey } from "../src/models/idempotency-key.model.js";
import { InstallmentPlan } from "../src/models/installment-plan.model.js";
import { JobLock } from "../src/models/job-lock.model.js";
import { RecurrenceRule } from "../src/models/recurrence-rule.model.js";
import { Session } from "../src/models/session.model.js";
import { Transaction } from "../src/models/transaction.model.js";
import { User } from "../src/models/user.model.js";
import { ensureIndexes as ensureRateLimitIndexes } from "../src/repositories/rate-limit.repository.js";

// Every model with indexes. A new model must be added here, or production runs without its indexes.
const MODELS = [
  User,
  Session,
  Account,
  Category,
  Transaction,
  RecurrenceRule,
  InstallmentPlan,
  Favourite,
  IdempotencyKey,
  JobLock,
];

// Active (non-archived) accounts and categories must carry activeNameKey before its partial unique index is built,
// or older rows get no uniqueness protection. Runs before syncIndexes; safe to repeat.
async function backfillActiveNameKeys() {
  for (const model of [Account, Category]) {
    const result = await model.updateMany(
      {
        archivedAt: null,
        activeNameKey: mongoose.trusted({ $exists: false }),
      },
      [{ $set: { activeNameKey: "$nameKey" } }],
      { updatePipeline: true },
    );
    logger.info(
      { model: model.modelName, updated: result.modifiedCount },
      "activeNameKey backfilled",
    );
  }
}

async function main() {
  if (env.DNS_SERVERS.length > 0) dns.setServers(env.DNS_SERVERS);
  await connectDb(env.MONGODB_URI, { autoIndex: false });
  await backfillActiveNameKeys();
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
