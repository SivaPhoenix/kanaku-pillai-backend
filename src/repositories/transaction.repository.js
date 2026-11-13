import mongoose from "mongoose";
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

// Per-account money movement (non-deleted entries, optionally up to an instant):
// Map<accountId, { income, expense, transferIn, transferOut }>.
export async function aggregateAccountFlows(userId, { until } = {}) {
  const match = { userId: toObjectId(userId), deletedAt: null };
  if (until) match.occurredAt = { $lte: until };

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
