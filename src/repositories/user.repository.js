import mongoose from "mongoose";
import { User } from "../models/user.model.js";

// Users are the tenant root, so these lookups are keyed by the user's own id, email or Google id rather than a userId filter.

export function findById(userId, { session } = {}) {
  return User.findById(userId)
    .session(session ?? null)
    .lean();
}

export function findByEmail(email, { withPassword = false, session } = {}) {
  const query = User.findOne({ email: email.toLowerCase() }).session(session ?? null);
  if (withPassword) query.select("+passwordHash");
  return query.lean();
}

export function findByGoogleSub(googleSub, { session } = {}) {
  return User.findOne({ googleSub })
    .session(session ?? null)
    .lean();
}

export async function create(fields, { session } = {}) {
  const [user] = await User.create([fields], { session });
  return user.toObject();
}

export function linkGoogle(
  userId,
  { googleSub, avatarUrl, emailVerifiedAt, removePassword },
  { session } = {},
) {
  const update = { $set: { googleSub, emailVerifiedAt } };
  if (avatarUrl) update.$set.avatarUrl = avatarUrl;
  if (removePassword) update.$unset = { passwordHash: 1 };
  return User.findByIdAndUpdate(userId, update, { returnDocument: "after", session }).lean();
}

export function hasPassword(userId, { session } = {}) {
  return User.exists({ _id: userId, passwordHash: mongoose.trusted({ $exists: true }) }).session(
    session ?? null,
  );
}

export function updateName(userId, name, { session } = {}) {
  return User.findByIdAndUpdate(
    userId,
    { $set: { name } },
    { returnDocument: "after", session },
  ).lean();
}

// Sets only the given settings keys, leaving the rest of the settings subdocument alone.
export function updateSettings(userId, changes, { session } = {}) {
  const set = Object.fromEntries(Object.entries(changes).map(([key, v]) => [`settings.${key}`, v]));
  return User.findByIdAndUpdate(userId, { $set: set }, { returnDocument: "after", session }).lean();
}

// Only verifies the address the link was sent to; if the account email has changed since, nothing is updated.
export function markEmailVerified(userId, email, { session, now = new Date() } = {}) {
  return User.findOneAndUpdate(
    { _id: userId, email },
    { $set: { emailVerifiedAt: now } },
    { returnDocument: "after", session },
  ).lean();
}

// Plain password change: unlike a reset, it proves nothing about the inbox, so emailVerifiedAt is left alone.
export function updatePasswordHash(userId, passwordHash, { session } = {}) {
  return User.updateOne({ _id: userId }, { $set: { passwordHash } }, { session });
}

// A reset link proves the user controls the inbox, so it also verifies the email if it was not yet.
export function setPassword(userId, passwordHash, { session, now = new Date() } = {}) {
  return User.findOneAndUpdate(
    { _id: userId },
    // $literal: argon2 hashes start with "$", which a pipeline would otherwise read as a field path.
    [
      {
        $set: {
          passwordHash: { $literal: passwordHash },
          emailVerifiedAt: { $ifNull: ["$emailVerifiedAt", now] },
        },
      },
    ],
    { returnDocument: "after", session, updatePipeline: true },
  ).lean();
}

export function findByIdWithPassword(userId, { session } = {}) {
  return User.findById(userId)
    .select("+passwordHash")
    .session(session ?? null)
    .lean();
}
