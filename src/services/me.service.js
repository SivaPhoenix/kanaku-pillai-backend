import { CURRENCY_LOCALES, FALLBACK_LOCALE } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as transactionRepository from "../repositories/transaction.repository.js";
import * as userDataRepository from "../repositories/user-data.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { verifyPassword } from "../utils/password.js";
import { withTransaction } from "../utils/transaction.js";
import { toUserDto } from "./user.service.js";

function accountNotFound() {
  return new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
}

async function userDto(userId, user) {
  const hasPassword = Boolean(await userRepository.hasPassword(userId));
  return toUserDto(user, { hasPassword });
}

export async function updateProfile(userId, { name }) {
  const user = await userRepository.updateName(userId, name);
  if (!user) throw accountNotFound();
  return userDto(userId, user);
}

// Changing the currency relabels every entry (amounts are never converted) in the same transaction as the settings write.
export async function updateSettings(userId, changes) {
  const current = await userRepository.findById(userId);
  if (!current) throw accountNotFound();

  const next = { ...changes };
  const currencyChanged =
    next.currencyCode !== undefined && next.currencyCode !== current.settings.currencyCode;
  if (currencyChanged && next.locale === undefined) {
    next.locale = CURRENCY_LOCALES[next.currencyCode] ?? FALLBACK_LOCALE;
  }

  const { user, relabeledCount } = await withTransaction(async (session) => {
    const updated = await userRepository.updateSettings(userId, next, { session });
    const count = currencyChanged
      ? await transactionRepository.relabelCurrency(userId, next.currencyCode, { session })
      : 0;
    return { user: updated, relabeledCount: count };
  });

  return { user: await userDto(userId, user), relabeledCount };
}

export async function listSessions(userId, currentSessionId) {
  const sessions = await sessionRepository.listActiveForUser(userId);
  return sessions.map((s) => ({
    id: String(s._id),
    platform: s.platform,
    userAgent: s.userAgent ?? null,
    ipAddress: s.ipAddress ?? null,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    current: String(s._id) === String(currentSessionId),
  }));
}

export async function revokeSession(userId, sessionId) {
  const revoked = await sessionRepository.revokeOwned(userId, sessionId, "logout");
  if (!revoked) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Session not found");
  }
}

// Accounts with a password must prove it; Google-only accounts confirm with the typed word alone.
export async function deleteAccount(userId, { password }) {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) throw accountNotFound();
  if (user.passwordHash) {
    if (!password || !(await verifyPassword(user.passwordHash, password))) {
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
        "The password is incorrect",
      );
    }
  }
  await userDataRepository.deleteAllForUser(userId);
}
