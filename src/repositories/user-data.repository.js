import { Account } from "../models/account.model.js";
import { Category } from "../models/category.model.js";
import { EmailToken } from "../models/email-token.model.js";
import { Favourite } from "../models/favourite.model.js";
import { IdempotencyKey } from "../models/idempotency-key.model.js";
import { InstallmentPlan } from "../models/installment-plan.model.js";
import { RecurrenceRule } from "../models/recurrence-rule.model.js";
import { Session } from "../models/session.model.js";
import { Transaction } from "../models/transaction.model.js";
import { User } from "../models/user.model.js";

// Every collection that holds per-user data. Add new user-owned models here, or account deletion leaves data behind.
const USER_OWNED_MODELS = [
  Transaction,
  RecurrenceRule,
  InstallmentPlan,
  Favourite,
  Category,
  Account,
  IdempotencyKey,
  EmailToken,
];

// Permanently removes a user and everything they own. Sessions go first so the account is unusable at once.
export async function deleteAllForUser(userId) {
  const counts = {};
  await Session.deleteMany({ userId });
  for (const model of USER_OWNED_MODELS) {
    const result = await model.deleteMany({ userId });
    counts[model.modelName] = result.deletedCount;
  }
  const user = await User.deleteOne({ _id: userId });
  counts.User = user.deletedCount;
  // Not one transaction (too large for big accounts), so a second sweep catches rows in-flight requests inserted meanwhile.
  for (const model of USER_OWNED_MODELS) {
    const result = await model.deleteMany({ userId });
    counts[model.modelName] += result.deletedCount;
  }
  return counts;
}
