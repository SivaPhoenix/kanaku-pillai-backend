import mongoose from "mongoose";
import { Account } from "../models/account.model.js";
import { Favourite } from "../models/favourite.model.js";
import { RecurrenceRule } from "../models/recurrence-rule.model.js";
import { Transaction } from "../models/transaction.model.js";

const { trusted } = mongoose;
const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// Every function is scoped by userId: an id that belongs to someone else behaves exactly like a missing one.

export function findOwned(userId, accountId, { session } = {}) {
  return Account.findOne({ _id: accountId, userId })
    .session(session ?? null)
    .lean();
}

export function findOwnedByIds(userId, accountIds, { session } = {}) {
  return Account.find({ userId, _id: trusted({ $in: accountIds.map(toObjectId) }) })
    .session(session ?? null)
    .lean();
}

export function listByUser(userId, { includeArchived = false, session } = {}) {
  const filter = { userId };
  if (!includeArchived) filter.archivedAt = null;
  return Account.find(filter)
    .sort({ sortOrder: 1, _id: 1 })
    .session(session ?? null)
    .lean();
}

export function countByUser(userId, { session } = {}) {
  return Account.countDocuments({ userId }).session(session ?? null);
}

export function countActiveByUser(userId, { session } = {}) {
  return Account.countDocuments({ userId, archivedAt: null }).session(session ?? null);
}

export async function maxSortOrder(userId, { session } = {}) {
  const top = await Account.findOne({ userId })
    .sort({ sortOrder: -1 })
    .select("sortOrder")
    .session(session ?? null)
    .lean();
  return top ? top.sortOrder : -1;
}

// A name is taken when another non-archived account of this user has the same lower-cased name.
export async function isNameTaken(userId, nameKey, { excludeId, session } = {}) {
  const filter = { userId, nameKey, archivedAt: null };
  if (excludeId) filter._id = trusted({ $ne: excludeId });
  return Boolean(await Account.exists(filter).session(session ?? null));
}

export async function create(userId, fields, { session } = {}) {
  const [account] = await Account.create([{ ...fields, userId }], { session });
  return account.toObject();
}

export async function createMany(userId, docs, { session } = {}) {
  const created = await Account.insertMany(
    docs.map((doc) => ({ ...doc, userId })),
    { session },
  );
  return created.map((doc) => doc.toObject());
}

export function updateOwned(userId, accountId, { set = {}, unset = {} }, { session } = {}) {
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return Account.findOneAndUpdate({ _id: accountId, userId }, update, {
    returnDocument: "after",
    session,
  }).lean();
}

export async function clearDefault(userId, { exceptId, session } = {}) {
  const filter = { userId, isDefault: true };
  if (exceptId) filter._id = trusted({ $ne: exceptId });
  await Account.updateMany(filter, { $set: { isDefault: false } }, { session });
}

export async function deleteOwned(userId, accountId, { session } = {}) {
  const result = await Account.deleteOne({ _id: accountId, userId }, { session });
  return result.deletedCount > 0;
}

export async function hasLinkedDebitCards(userId, accountId) {
  return Boolean(await Account.exists({ userId, linkedAccountId: accountId }));
}

export async function findLinkedDebitIds(userId, bankId) {
  const cards = await Account.find({ userId, linkedAccountId: bankId, type: "debit_card" })
    .select("_id")
    .lean();
  return cards.map((card) => card._id);
}

// Favourites and repeat rules keep pointing at an account, so it can't be deleted while they do.
export async function isUsedByTemplates(userId, accountId) {
  const [favourite, rule] = await Promise.all([
    Favourite.exists({ userId, $or: [{ accountId }, { toAccountId: accountId }] }),
    RecurrenceRule.exists({
      userId,
      $or: [{ "template.accountId": accountId }, { "template.toAccountId": accountId }],
    }),
  ]);
  return Boolean(favourite || rule);
}

export async function setSortOrders(userId, orderedIds, { session } = {}) {
  const operations = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: id, userId }, update: { $set: { sortOrder: index } } },
  }));
  if (operations.length > 0) await Account.bulkWrite(operations, { session });
}

// In/out and the latest entries for one account in a month. `debitIds` are the linked debit cards of a bank.
export async function monthActivity(userId, accountId, debitIds, month, { limit = 10 } = {}) {
  const self = toObjectId(accountId);
  const ids = [self, ...debitIds.map(toObjectId)];
  const sumWhen = (condition) => ({ $sum: { $cond: [condition, "$amountMinor", 0] } });
  const isTransferIn = {
    $and: [{ $eq: ["$type", "transfer"] }, { $eq: ["$toAccountId", self] }],
  };
  const isTransferOut = { $and: [{ $eq: ["$type", "transfer"] }, { $eq: ["$accountId", self] }] };

  const [result] = await Transaction.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        deletedAt: null,
        localMonth: month,
        $or: [{ accountId: { $in: ids } }, { toAccountId: self }],
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              inMinor: sumWhen({ $or: [{ $eq: ["$type", "income"] }, isTransferIn] }),
              outMinor: sumWhen({ $or: [{ $eq: ["$type", "expense"] }, isTransferOut] }),
            },
          },
        ],
        recent: [{ $sort: { occurredAt: -1, _id: -1 } }, { $limit: limit }],
      },
    },
  ]);
  const totals = result?.totals?.[0];
  return {
    inMinor: totals?.inMinor ?? 0,
    outMinor: totals?.outMinor ?? 0,
    recent: result?.recent ?? [],
  };
}
