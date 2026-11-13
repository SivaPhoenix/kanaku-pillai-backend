import { isDbConnected } from "../config/db.js";

// Readiness: the instance can serve traffic only while its database connection is up.
export function getReadiness() {
  const database = isDbConnected() ? "up" : "down";
  return { ready: database === "up", checks: { database } };
}
