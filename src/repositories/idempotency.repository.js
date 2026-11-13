import { IdempotencyKey } from "../models/idempotency-key.model.js";
import { isDuplicateKeyError } from "../utils/transaction.js";

const TTL_MS = 24 * 60 * 60 * 1000;

// Claims the key for this request. Returns { claimed: true } or { claimed: false, existing } when it was seen before.
export async function claim(userId, { key, route, requestHash }) {
  try {
    await IdempotencyKey.create({
      userId,
      key,
      route,
      requestHash,
      status: "in_progress",
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    return { claimed: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await IdempotencyKey.findOne({ userId, key }).lean();
    return { claimed: false, existing };
  }
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
