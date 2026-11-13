import mongoose from "mongoose";
import { TOTAL_TX_TYPES } from "../constants/enums.js";
import { Transaction } from "../models/transaction.model.js";

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// Every aggregation reads live income/expense entries only (transfers and soft-deleted entries never count).
function baseMatch(userId, { from, to, type }) {
  return {
    userId: toObjectId(userId),
    deletedAt: null,
    type: type ?? { $in: TOTAL_TX_TYPES },
    localDate: { $gte: from, $lte: to },
  };
}

export async function totalsByType(userId, range) {
  const rows = await Transaction.aggregate([
    { $match: baseMatch(userId, range) },
    { $group: { _id: "$type", total: { $sum: "$amountMinor" } } },
  ]);
  const totals = { incomeMinor: 0, expenseMinor: 0 };
  for (const row of rows) totals[`${row._id}Minor`] = row.total;
  return totals;
}

async function groupBy(userId, range, field) {
  const rows = await Transaction.aggregate([
    { $match: baseMatch(userId, range) },
    { $group: { _id: `$${field}`, total: { $sum: "$amountMinor" } } },
    { $sort: { total: -1, _id: 1 } },
  ]);
  return rows.map((row) => ({ id: String(row._id), amountMinor: row.total }));
}

export const totalsByCategory = (userId, range) => groupBy(userId, range, "categoryId");

export const totalsByAccount = (userId, range) => groupBy(userId, range, "accountId");

// Rows of { localDate, type, amountMinor } for days that have activity.
export async function totalsByDay(userId, range) {
  const rows = await Transaction.aggregate([
    { $match: baseMatch(userId, range) },
    {
      $group: { _id: { localDate: "$localDate", type: "$type" }, total: { $sum: "$amountMinor" } },
    },
  ]);
  return rows.map((row) => ({
    localDate: row._id.localDate,
    type: row._id.type,
    amountMinor: row.total,
  }));
}

// Rows of { month, amountMinor } for months that have activity of one type.
export async function totalsByMonth(userId, { fromMonth, toMonth, type }) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        deletedAt: null,
        type,
        localMonth: { $gte: fromMonth, $lte: toMonth },
      },
    },
    { $group: { _id: "$localMonth", total: { $sum: "$amountMinor" } } },
  ]);
  return rows.map((row) => ({ month: row._id, amountMinor: row.total }));
}
