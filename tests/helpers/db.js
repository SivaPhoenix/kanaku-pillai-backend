import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../../src/config/db.js";

let replSet;

// A one-node in-memory replica set, so tests can use multi-document transactions like production.
export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await connectDb(replSet.getUri("kanaku_pillai_test"));
}

export async function stopTestDb() {
  await disconnectDb();
  await replSet?.stop();
  replSet = undefined;
}

export async function resetTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
