import mongoose from "mongoose";
import { EmailToken } from "../models/email-token.model.js";

const { trusted } = mongoose;

export async function create(userId, { purpose, tokenHash, email, expiresAt }, { session } = {}) {
  const [doc] = await EmailToken.create([{ userId, purpose, tokenHash, email, expiresAt }], {
    session,
  });
  return doc.toObject();
}

export function findLatest(userId, purpose) {
  return EmailToken.findOne({ userId, purpose }).sort({ createdAt: -1 }).lean();
}

// A new link replaces any earlier unused one, so only the newest email works.
export function deleteUnused(userId, purpose, { session } = {}) {
  return EmailToken.deleteMany({ userId, purpose, usedAt: null }, { session });
}

// Like a refresh token, the link token itself identifies its owner, so these two lookups are keyed by its digest, not a userId.
export function findByTokenHash(purpose, tokenHash) {
  return EmailToken.findOne({ purpose, tokenHash }).lean();
}

// Marks the token used only if it is still unused and unexpired, so two concurrent requests cannot both redeem it.
export function consume(purpose, tokenHash, { session, now = new Date() } = {}) {
  return EmailToken.findOneAndUpdate(
    { purpose, tokenHash, usedAt: null, expiresAt: trusted({ $gt: now }) },
    { $set: { usedAt: now } },
    { returnDocument: "after", session },
  ).lean();
}
