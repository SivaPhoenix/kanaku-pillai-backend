import mongoose from "mongoose";

// Runs fn(session) in a MongoDB transaction; Mongoose retries on transient errors and commits or aborts as a unit.
export async function withTransaction(fn) {
  let result;
  await mongoose.connection.transaction(async (session) => {
    result = await fn(session);
  });
  return result;
}

export function isDuplicateKeyError(error) {
  return error?.code === 11000;
}
