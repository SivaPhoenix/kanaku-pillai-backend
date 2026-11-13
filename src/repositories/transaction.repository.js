import mongoose from "mongoose";
import { Account } from "../models/account.model.js";
import { Category } from "../models/category.model.js";
import { Transaction } from "../models/transaction.model.js";

const { trusted } = mongoose;
const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// Every function is scoped by userId. Docs passed to insertMany must already carry localDate/localMonth (see services).

export async function insertMany(userId, docs, { session } = {}) {
  const created = await Transaction.insertMany(
    docs.map((doc) => ({ ...doc, userId })),
    { session },
  );
  return created.map((doc) => doc.toObject());
}

// Currency change relabels every entry and never converts amounts (design spec §1.1).
export async function relabelCurrency(userId, currencyCode, { session } = {}) {
  const result = await Transaction.updateMany(
    { userId, currencyCode: trusted({ $ne: currencyCode }) },
    { $set: { currencyCode } },
    { session },
  );
  return result.modifiedCount;
}

// Soft-deleted entries still count: they can be restored, so the account or category must stay.
export async function isAccountReferenced(userId, accountId) {
  return Boolean(
    await Transaction.exists({ userId, $or: [{ accountId }, { toAccountId: accountId }] }),
  );
}

export async function isCategoryReferenced(userId, categoryId) {
  return Boolean(await Transaction.exists({ userId, categoryId }));
}

// Per-account money movement (non-deleted entries, optionally up to an instant or a local date):
// Map<accountId, { income, expense, transferIn, transferOut }>.
export async function aggregateAccountFlows(userId, { until, untilLocalDate } = {}) {
  const match = { userId: toObjectId(userId), deletedAt: null };
  if (until) match.occurredAt = { $lte: until };
  if (untilLocalDate) match.localDate = { $lte: untilLocalDate };

  const [result] = await Transaction.aggregate([
    { $match: match },
    {
      $facet: {
        bySource: [
          {
            $group: {
              _id: { accountId: "$accountId", type: "$type" },
              total: { $sum: "$amountMinor" },
            },
          },
        ],
        transfersIn: [
          { $match: { type: "transfer" } },
          { $group: { _id: "$toAccountId", total: { $sum: "$amountMinor" } } },
        ],
      },
    },
  ]);

  const flows = new Map();
  const entry = (id) => {
    const key = String(id);
    if (!flows.has(key)) flows.set(key, { income: 0, expense: 0, transferIn: 0, transferOut: 0 });
    return flows.get(key);
  };
  for (const row of result?.bySource ?? []) {
    const flow = entry(row._id.accountId);
    if (row._id.type === "income") flow.income += row.total;
    else if (row._id.type === "expense") flow.expense += row.total;
    else flow.transferOut += row.total;
  }
  for (const row of result?.transfersIn ?? []) entry(row._id).transferIn += row.total;
  return flows;
}

const SORT_NEWEST = { occurredAt: -1, _id: -1 };
const oid = toObjectId;
const noWrap = (value) => value;

export function findActive(userId, id, { session } = {}) {
  return Transaction.findOne({ _id: id, userId, deletedAt: null })
    .session(session ?? null)
    .lean();
}

export async function create(userId, doc, { session } = {}) {
  const [created] = await insertMany(userId, [doc], { session });
  return created;
}

// fields: values to set; unsetFields: names to remove.
export function updateActive(userId, id, fields, unsetFields = []) {
  const update = { $set: fields };
  if (unsetFields.length > 0) update.$unset = Object.fromEntries(unsetFields.map((f) => [f, ""]));
  return Transaction.findOneAndUpdate({ _id: id, userId, deletedAt: null }, update, {
    returnDocument: "after",
  }).lean();
}

export function softDelete(userId, id, deletedAt) {
  return Transaction.findOneAndUpdate(
    { _id: id, userId, deletedAt: null },
    { $set: { deletedAt } },
    { returnDocument: "after" },
  ).lean();
}

export function restore(userId, id) {
  return Transaction.findOneAndUpdate(
    { _id: id, userId, deletedAt: mongoose.trusted({ $ne: null }) },
    { $unset: { deletedAt: "" } },
    { returnDocument: "after" },
  ).lean();
}

function searchClause(search, wrap) {
  const or = [{ note: new RegExp(search.pattern, "i") }];
  if (search.categoryIds.length > 0) {
    or.push({ categoryId: wrap({ $in: search.categoryIds.map(oid) }) });
  }
  if (search.accountIds.length > 0) {
    const ids = wrap({ $in: search.accountIds.map(oid) });
    or.push({ accountId: ids }, { toAccountId: ids });
  }
  if (search.amountMinor) or.push({ amountMinor: search.amountMinor });
  return { $or: or };
}

// filters: { from, to, type, accountId, categoryId, min, max, search }. `wrap` is mongoose.trusted for find() filters.
function buildMatch(userId, filters, wrap) {
  const match = { userId: oid(userId), deletedAt: null };
  const and = [];
  if (filters.from || filters.to) {
    match.localDate = wrap({
      ...(filters.from && { $gte: filters.from }),
      ...(filters.to && { $lte: filters.to }),
    });
  }
  if (filters.type) match.type = filters.type;
  if (filters.categoryId) match.categoryId = oid(filters.categoryId);
  if (filters.min || filters.max) {
    match.amountMinor = wrap({
      ...(filters.min && { $gte: filters.min }),
      ...(filters.max && { $lte: filters.max }),
    });
  }
  if (filters.accountId) {
    const id = oid(filters.accountId);
    and.push({ $or: [{ accountId: id }, { toAccountId: id }] });
  }
  if (filters.search) and.push(searchClause(filters.search, wrap));
  if (filters.cursorFilter) and.push(filters.cursorFilter);
  if (and.length > 0) match.$and = and;
  return match;
}

export function findFiltered(userId, filters, { limit, cursorFilter } = {}) {
  const match = buildMatch(userId, { ...filters, cursorFilter }, trusted);
  return Transaction.find(match).sort(SORT_NEWEST).limit(limit).lean();
}

export async function summarizeFiltered(userId, filters) {
  const [row] = await Transaction.aggregate([
    { $match: buildMatch(userId, filters, noWrap) },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        incomeMinor: {
          $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amountMinor", 0] },
        },
        expenseMinor: {
          $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amountMinor", 0] },
        },
      },
    },
  ]);
  const { count = 0, incomeMinor = 0, expenseMinor = 0 } = row ?? {};
  return { count, incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}

export async function findAccountIdsByName(userId, pattern) {
  const rows = await Account.find({ userId, name: new RegExp(pattern, "i") })
    .select("_id")
    .lean();
  return rows.map((row) => row._id);
}

export async function findCategoryIdsByName(userId, pattern) {
  const rows = await Category.find({ userId, name: new RegExp(pattern, "i") })
    .select("_id")
    .lean();
  return rows.map((row) => row._id);
}

export function findAccountNamesByIds(userId, ids) {
  return Account.find({ userId, _id: trusted({ $in: ids }) })
    .select("name")
    .lean();
}

export function findCategoryNamesByIds(userId, ids) {
  return Category.find({ userId, _id: trusted({ $in: ids }) })
    .select("name")
    .lean();
}
