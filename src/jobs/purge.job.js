import { logger } from "../config/logger.js";
import { purgeExpired } from "../services/purge.service.js";

export async function runPurgeJob(options) {
  const result = await purgeExpired(options);
  logger.info(result, "Purge finished");
  return result;
}
