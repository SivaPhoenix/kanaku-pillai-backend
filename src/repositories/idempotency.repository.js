import mongoose from "mongoose";
import { IdempotencyKey } from "../models/idempotency-key.model.js";
import { isDuplicateKeyError } from "../utils/transaction.js";

const TTL_MS = 24 * 60 * 60 * 1000;

// An in_progress row older than this belonged to a request that died, so a retry may take it over.
const STALE_MS = 60 * 1000;

// Takes over a stale in_progress claim for the same request. Returns true when this caller now owns it.
async function takeOverStale(userId, { key, route, requestHash }, now) {
  const taken = await IdempotencyKey.findOneAndUpdate(
    {
      userId,
      key,
      status: "in_progress",
      requestHash,
      claimedAt: mongoose.trusted({ $lt: new Date(now.getTime() - STALE_MS) }),
    },
    { $set: { requestHash, route, claimedAt: now } },
    { returnDocument: "after" },
  ).lean();
  return Boolean(taken);
}

// Claims the key for this request. Returns { claimed: true } or { claimed: false, existing } when it was seen before.
export async function claim(userId, { key, route, requestHash }, { retry = true } = {}) {
  const now = new Date();
  try {
    await IdempotencyKey.create({
      userId,
      key,
      route,
      requestHash,
      status: "in_progress",
      claimedAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS),
    });
    return { claimed: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const existing = await IdempotencyKey.findOne({ userId, key }).lean();
  // Released between the duplicate error and the read: claim again once.
  if (!existing) {
    if (retry) return claim(userId, { key, route, requestHash }, { retry: false });
    throw new Error("Idempotency key vanished while claiming");
  }
  if (existing.status === "in_progress" && existing.requestHash === requestHash) {
    if (await takeOverStale(userId, { key, route, requestHash }, now)) return { claimed: true };
  }
  return { claimed: false, existing };
}

export function complete(userId, key, { responseStatus, responseBody }) {
  return IdempotencyKey.updateOne(
    { userId, key },
    { $set: { status: "completed", responseStatus, responseBody } },
  );
}

// A failed request releases its key so the client can retry with the same one.
export function release(userId, key) {
  return IdempotencyKey.deleteOne({ userId, key, status: "in_progress" });
}
