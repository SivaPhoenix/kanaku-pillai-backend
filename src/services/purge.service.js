import { SOFT_DELETE_RETENTION_DAYS } from "../constants/enums.js";
import * as purgeRepository from "../repositories/purge.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Hard-deletes entries soft-deleted past the retention window, then instalment plans left without entries.
export async function purgeExpired({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * DAY_MS);
  const transactions = await purgeRepository.deleteTransactionsSoftDeletedBefore(cutoff);
  const installmentPlans = await purgeRepository.deleteOrphanInstallmentPlans();
  return { transactions, installmentPlans };
}
