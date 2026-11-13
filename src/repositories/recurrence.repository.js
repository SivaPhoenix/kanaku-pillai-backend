import mongoose from "mongoose";
import { RecurrenceRule } from "../models/recurrence-rule.model.js";

// Every function is scoped by userId (the worker's cross-user scan lives in its own function, clearly named).

export async function create(userId, fields, { session } = {}) {
  const [rule] = await RecurrenceRule.create([{ ...fields, userId }], { session });
  return rule.toObject();
}

export function listNotStopped(userId) {
  return RecurrenceRule.find({ userId, stoppedAt: null }).lean();
}

export function countNotStopped(userId) {
  return RecurrenceRule.countDocuments({ userId, stoppedAt: null });
}

export function findOwnedNotStopped(userId, ruleId) {
  return RecurrenceRule.findOne({ _id: ruleId, userId, stoppedAt: null }).lean();
}

// `set` and `unset` are server-built from validated fields.
export function update(userId, ruleId, { set = {}, unset = [] }) {
  const change = { $set: set };
  if (unset.length > 0) change.$unset = Object.fromEntries(unset.map((key) => [key, 1]));
  return RecurrenceRule.findOneAndUpdate({ _id: ruleId, userId, stoppedAt: null }, change, {
    returnDocument: "after",
  }).lean();
}

export function markStopped(userId, ruleId, now = new Date()) {
  return RecurrenceRule.findOneAndUpdate(
    { _id: ruleId, userId, stoppedAt: null },
    { $set: { stoppedAt: now } },
    { returnDocument: "after" },
  ).lean();
}

// Active rules (not stopped, not paused, not past their end date) whose next date is on or before `untilDate`.
// The date is a coarse bound from the furthest-ahead zone; the service checks each rule against its own zone.
export function findDueRulesAcrossUsers(untilDate, limit) {
  const notFinished = {
    $or: [{ $eq: [{ $type: "$endsOn" }, "missing"] }, { $lte: ["$nextOccurrenceDate", "$endsOn"] }],
  };
  return RecurrenceRule.find({
    stoppedAt: null,
    pausedAt: null,
    nextOccurrenceDate: mongoose.trusted({ $lte: untilDate }),
    $expr: mongoose.trusted(notFinished),
  })
    .sort({ nextOccurrenceDate: 1, _id: 1 })
    .limit(limit)
    .lean();
}

export function advance(userId, ruleId, { nextOccurrenceDate, lastGeneratedFor, pausedAt }) {
  const set = { nextOccurrenceDate };
  if (lastGeneratedFor) set.lastGeneratedFor = lastGeneratedFor;
  if (pausedAt) set.pausedAt = pausedAt;
  return RecurrenceRule.updateOne({ _id: ruleId, userId, stoppedAt: null }, { $set: set });
}
