import { Account } from "../models/account.model.js";

// Every function is scoped by userId: an id that belongs to someone else behaves exactly like a missing one.

export function findOwned(userId, accountId, { session } = {}) {
  return Account.findOne({ _id: accountId, userId })
    .session(session ?? null)
    .lean();
}

export function findOwnedByIds(userId, accountIds, { session } = {}) {
  return Account.find({ userId, _id: { $in: accountIds } })
    .session(session ?? null)
    .lean();
}
