import mongoose from "mongoose";
import { Favourite } from "../models/favourite.model.js";

// Every function is scoped by userId.

export function listSorted(userId) {
  return Favourite.find({ userId }).sort({ sortOrder: 1, _id: 1 }).lean();
}

export function findOwned(userId, favouriteId) {
  return Favourite.findOne({ _id: favouriteId, userId }).lean();
}

export function countByUser(userId) {
  return Favourite.countDocuments({ userId });
}

export async function maxSortOrder(userId) {
  const top = await Favourite.findOne({ userId })
    .sort({ sortOrder: -1 })
    .select("sortOrder")
    .lean();
  return top ? top.sortOrder : -1;
}

export async function create(userId, fields) {
  const favourite = await Favourite.create({ ...fields, userId });
  return favourite.toObject();
}

// `set` and `unset` are server-built from validated fields.
export function update(userId, favouriteId, { set = {}, unset = [] }) {
  const change = { $set: set };
  if (unset.length > 0) change.$unset = Object.fromEntries(unset.map((key) => [key, 1]));
  return Favourite.findOneAndUpdate({ _id: favouriteId, userId }, change, {
    returnDocument: "after",
  }).lean();
}

export async function deleteOwned(userId, favouriteId) {
  const result = await Favourite.deleteOne({ _id: favouriteId, userId });
  return result.deletedCount > 0;
}

export async function setOrder(userId, orderedIds) {
  await Favourite.bulkWrite(
    orderedIds.map((id, index) => ({
      updateOne: { filter: { _id: id, userId }, update: { $set: { sortOrder: index } } },
    })),
  );
}

export function countOwnedByIds(userId, ids) {
  return Favourite.countDocuments({
    userId,
    _id: mongoose.trusted({ $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) }),
  });
}
