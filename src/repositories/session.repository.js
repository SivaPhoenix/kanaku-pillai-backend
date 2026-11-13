import mongoose from "mongoose";
import { Session } from "../models/session.model.js";

// sanitizeFilter neutralises any $-operator in a filter; operators the server writes itself are marked trusted.
const { trusted } = mongoose;

export async function create(userId, fields, { session } = {}) {
  const [doc] = await Session.create([{ ...fields, userId }], { session });
  return doc.toObject();
}

export function findActive(userId, sessionId, now = new Date()) {
  return Session.findOne({
    _id: sessionId,
    userId,
    revokedAt: null,
    expiresAt: trusted({ $gt: now }),
  }).lean();
}

export function findByTokenHash(tokenHash) {
  return Session.findOne({ tokenHash }).lean();
}

export function findByPreviousTokenHash(tokenHash) {
  return Session.findOne({ previousTokenHash: tokenHash }).lean();
}

// The current hash must still match, so two concurrent refreshes with the same token cannot both succeed.
export function rotate(
  userId,
  sessionId,
  { currentTokenHash, nextTokenHash, expiresAt, now = new Date() },
) {
  return Session.findOneAndUpdate(
    { _id: sessionId, userId, tokenHash: currentTokenHash, revokedAt: null },
    {
      $set: {
        tokenHash: nextTokenHash,
        previousTokenHash: currentTokenHash,
        lastUsedAt: now,
        expiresAt,
      },
    },
    { returnDocument: "after" },
  ).lean();
}

export function revoke(userId, sessionId, reason, now = new Date()) {
  return Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: now, revokedReason: reason } },
  );
}

export function revokeAllForUser(userId, reason, { session, now = new Date() } = {}) {
  return Session.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: now, revokedReason: reason } },
    { session },
  );
}

export function listActiveForUser(userId, now = new Date()) {
  return Session.find({ userId, revokedAt: null, expiresAt: trusted({ $gt: now }) })
    .sort({ lastUsedAt: -1, _id: -1 })
    .lean();
}

// Resolves to true only when an active session of this user was revoked.
export async function revokeOwned(userId, sessionId, reason, now = new Date()) {
  const result = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null, expiresAt: trusted({ $gt: now }) },
    { $set: { revokedAt: now, revokedReason: reason } },
  );
  return result.modifiedCount === 1;
}
