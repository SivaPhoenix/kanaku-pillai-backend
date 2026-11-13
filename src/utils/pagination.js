import mongoose from "mongoose";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

// Opaque cursor for "newest first" lists sorted by (occurredAt desc, _id desc).
export function encodeCursor({ occurredAt, _id }) {
  return Buffer.from(JSON.stringify({ o: occurredAt.toISOString(), i: String(_id) })).toString(
    "base64url",
  );
}

// Returns null for anything malformed, so a tampered cursor simply restarts the list.
export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const { o, i } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const occurredAt = new Date(o);
    if (Number.isNaN(occurredAt.getTime()) || !mongoose.isValidObjectId(i)) return null;
    return { occurredAt, id: new mongoose.Types.ObjectId(i) };
  } catch {
    return null;
  }
}

// Mongo filter for "rows after this cursor" in (occurredAt desc, _id desc) order; operators are server-built, so trusted.
export function afterCursorFilter(cursor) {
  if (!cursor) return {};
  return {
    $or: [
      { occurredAt: mongoose.trusted({ $lt: cursor.occurredAt }) },
      { occurredAt: cursor.occurredAt, _id: mongoose.trusted({ $lt: cursor.id }) },
    ],
  };
}

// Fetch limit + 1 rows, then call this: returns the page and the next cursor (null at the end).
export function toPage(rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null, limit };
}
