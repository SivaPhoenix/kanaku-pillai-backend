import mongoose from "mongoose";
import { JobLock } from "../models/job-lock.model.js";
import { isDuplicateKeyError } from "../utils/transaction.js";

// Claims the named job when nobody holds it or the previous hold expired. Returns true when this owner now holds it.
// With minGapMs, a job that finished more recently than that is not claimed again.
export async function acquire(name, owner, ttlMs, now = new Date(), { minGapMs = 0 } = {}) {
  const filter = { _id: name, lockedUntil: mongoose.trusted({ $lt: now }) };
  if (minGapMs > 0) {
    const cutoff = new Date(now.getTime() - minGapMs);
    filter.$or = [{ lastRunAt: null }, { lastRunAt: mongoose.trusted({ $lte: cutoff }) }];
  }
  try {
    const lock = await JobLock.findOneAndUpdate(
      filter,
      { $set: { owner, lockedUntil: new Date(now.getTime() + ttlMs) } },
      { upsert: true, returnDocument: "after" },
    ).lean();
    return lock?.owner === owner;
  } catch (error) {
    // The document exists and is still held, so the upsert collided on _id.
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

export async function release(name, owner, result, now = new Date()) {
  await JobLock.updateOne(
    { _id: name, owner },
    { $set: { lockedUntil: new Date(0), lastRunAt: now, lastResult: result ?? null } },
  );
}
