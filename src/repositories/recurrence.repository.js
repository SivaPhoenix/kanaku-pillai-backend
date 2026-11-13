import { RecurrenceRule } from "../models/recurrence-rule.model.js";

// Every function is scoped by userId (the worker's cross-user scan lives in its own function, clearly named).

export async function create(userId, fields, { session } = {}) {
  const [rule] = await RecurrenceRule.create([{ ...fields, userId }], { session });
  return rule.toObject();
}
