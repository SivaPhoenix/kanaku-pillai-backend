import mongoose from "mongoose";
import { Category } from "../models/category.model.js";
import { Favourite } from "../models/favourite.model.js";
import { RecurrenceRule } from "../models/recurrence-rule.model.js";
import { Transaction } from "../models/transaction.model.js";

const { trusted } = mongoose;
const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// Every function is scoped by userId: an id that belongs to someone else behaves exactly like a missing one.

export function findOwned(userId, categoryId, { session } = {}) {
  return Category.findOne({ _id: categoryId, userId })
    .session(session ?? null)
    .lean();
}

export function findOwnedByIds(userId, categoryIds, { session } = {}) {
  return Category.find({ userId, _id: trusted({ $in: categoryIds.map(toObjectId) }) })
    .session(session ?? null)
    .lean();
}

export function listByUser(userId, { kind, includeArchived = false, session } = {}) {
  const filter = { userId };
  if (kind) filter.kind = kind;
  if (!includeArchived) filter.archivedAt = null;
  return Category.find(filter)
    .sort({ kind: 1, sortOrder: 1, _id: 1 })
    .session(session ?? null)
    .lean();
}

export function countActiveByKind(userId, kind, { session } = {}) {
  return Category.countDocuments({ userId, kind, archivedAt: null }).session(session ?? null);
}

export async function maxSortOrder(userId, kind, { session } = {}) {
  const top = await Category.findOne({ userId, kind })
    .sort({ sortOrder: -1 })
    .select("sortOrder")
    .session(session ?? null)
    .lean();
  return top ? top.sortOrder : -1;
}

export async function isNameTaken(userId, kind, nameKey, { excludeId, session } = {}) {
  const filter = { userId, kind, nameKey, archivedAt: null };
  if (excludeId) filter._id = trusted({ $ne: excludeId });
  return Boolean(await Category.exists(filter).session(session ?? null));
}

export async function create(userId, fields, { session } = {}) {
  const [category] = await Category.create([{ ...fields, userId }], { session });
  return category.toObject();
}

export async function createMany(userId, docs, { session } = {}) {
  const created = await Category.insertMany(
    docs.map((doc) => ({ ...doc, userId })),
    { session },
  );
  return created.map((doc) => doc.toObject());
}

export function updateOwned(userId, categoryId, { set = {}, unset = {} }, { session } = {}) {
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return Category.findOneAndUpdate({ _id: categoryId, userId }, update, {
    returnDocument: "after",
    session,
  }).lean();
}

export async function deleteOwned(userId, categoryId, { session } = {}) {
  const result = await Category.deleteOne({ _id: categoryId, userId }, { session });
  return result.deletedCount > 0;
}

export async function isUsedByTemplates(userId, categoryId) {
  const [favourite, rule] = await Promise.all([
    Favourite.exists({ userId, categoryId }),
    RecurrenceRule.exists({ userId, "template.categoryId": categoryId }),
  ]);
  return Boolean(favourite || rule);
}

export async function setSortOrders(userId, orderedIds, { session } = {}) {
  const operations = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: id, userId }, update: { $set: { sortOrder: index } } },
  }));
  if (operations.length > 0) await Category.bulkWrite(operations, { session });
}

// Map<categoryId, count> of the user's non-deleted entries in a month, in one aggregation.
export async function usageByCategory(userId, month) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        deletedAt: null,
        localMonth: month,
        categoryId: { $exists: true, $ne: null },
      },
    },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}
