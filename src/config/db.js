import mongoose from "mongoose";
import { logger } from "./logger.js";

// Unknown filter keys are dropped and filter values like { $gt: "" } are wrapped in $eq, so request data cannot inject query operators.
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

const connection = mongoose.connection;

connection.on("connected", () => logger.info("MongoDB connected"));
connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
connection.on("reconnected", () => logger.info("MongoDB reconnected"));
connection.on("error", (error) => logger.error({ err: error }, "MongoDB connection error"));

export async function connectDb(uri, { autoIndex = true } = {}) {
  await mongoose.connect(uri, {
    autoIndex,
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
  });
  return connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function isDbConnected() {
  return connection.readyState === mongoose.ConnectionStates.connected;
}
