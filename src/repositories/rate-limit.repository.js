import mongoose from "mongoose";

const COLLECTION = "rate_limits";

function collection() {
  return mongoose.connection.collection(COLLECTION);
}

// Counters expire on their own once their window ends.
export async function ensureIndexes() {
  await collection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

// One atomic upsert: restart the window when it has ended, otherwise add a hit.
export async function increment(key, windowMs, now = new Date()) {
  const windowEnd = new Date(now.getTime() + windowMs);
  const stillOpen = { $gt: ["$expiresAt", now] };
  const doc = await collection().findOneAndUpdate(
    { _id: key },
    [
      {
        $set: {
          hits: { $cond: [stillOpen, { $add: ["$hits", 1] }, 1] },
          expiresAt: { $cond: [stillOpen, "$expiresAt", windowEnd] },
        },
      },
    ],
    { upsert: true, returnDocument: "after" },
  );
  return { totalHits: doc.hits, resetTime: doc.expiresAt };
}

export async function decrement(key) {
  await collection().updateOne({ _id: key, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
}

export async function reset(key) {
  await collection().deleteOne({ _id: key });
}
