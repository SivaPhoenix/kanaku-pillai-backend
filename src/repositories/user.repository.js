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
