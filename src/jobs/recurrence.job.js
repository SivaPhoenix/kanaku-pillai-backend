import { logger } from "../config/logger.js";
import { generateDueOccurrences } from "../services/recurrence-generation.service.js";

export async function runRecurrenceJob(options) {
  const result = await generateDueOccurrences(options);
  logger.info(result, "Repeat generation finished");
  return result;
}
