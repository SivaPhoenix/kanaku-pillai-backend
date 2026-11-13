import { Category } from "../models/category.model.js";

// Every function is scoped by userId: an id that belongs to someone else behaves exactly like a missing one.

export function findOwned(userId, categoryId, { session } = {}) {
  return Category.findOne({ _id: categoryId, userId })
    .session(session ?? null)
    .lean();
}

export function findOwnedByIds(userId, categoryIds, { session } = {}) {
  return Category.find({ userId, _id: { $in: categoryIds } })
    .session(session ?? null)
    .lean();
}
