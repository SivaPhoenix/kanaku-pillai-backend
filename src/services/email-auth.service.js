import {
  EMAIL_RESEND_COOLDOWN_SECONDS,
  RESET_PASSWORD_PATH,
  RESET_PASSWORD_TTL_MINUTES,
  VERIFY_EMAIL_PATH,
  VERIFY_EMAIL_TTL_HOURS,
} from "../constants/auth.js";
import { EMAIL_TOKEN_PURPOSE } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "../integrations/mail/templates/auth-emails.js";
import { sendMail } from "../integrations/mail/mail-transport.js";
import * as emailTokenRepository from "../repositories/email-token.repository.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { generateToken, sha256 } from "../utils/crypto.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { withTransaction } from "../utils/transaction.js";

const { VERIFY_EMAIL, RESET_PASSWORD } = EMAIL_TOKEN_PURPOSE;
const MINUTE_MS = 60 * 1000;

const invalidLink = (message) =>
  new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_LINK, message);

const INVALID_RESET = "This reset link is invalid or has expired. Request a new one.";
const INVALID_VERIFY = "This verification link is invalid or has expired. Request a new one.";

// The token goes in the URL fragment (#token=…), which browsers never send to servers or in Referer headers.
function linkFor(path, token) {
  return `${env.APP_WEB_URL}${path}#token=${token}`;
}

async function inCooldown(userId, purpose, now) {
  const latest = await emailTokenRepository.findLatest(userId, purpose);
  return Boolean(latest) && now - latest.createdAt < EMAIL_RESEND_COOLDOWN_SECONDS * 1000;
}

// Earlier unused links stay valid until they expire or one of them is used; replacing them would let anyone who
// knows an address keep killing that user's reset link by requesting a new one every minute.
async function issueToken(user, purpose, ttlMs, now) {
  const token = generateToken();
  await emailTokenRepository.create(user._id, {
    purpose,
    tokenHash: sha256(token),
    email: user.email,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return token;
}

// Sending never fails the request: a mail outage is logged, and the user can ask again once it recovers.
async function deliver(message, to, { userId, kind }) {
  try {
    await sendMail({ to, ...message });
  } catch (error) {
    // Only the codes: SMTP error messages can quote the recipient address, and logs never hold emails.
    logger.error(
      { errCode: error.code, responseCode: error.responseCode, userId: String(userId), kind },
      "Email delivery failed",
    );
  }
}

export async function sendVerificationEmail(user, { now = new Date() } = {}) {
  const token = await issueToken(user, VERIFY_EMAIL, VERIFY_EMAIL_TTL_HOURS * 60 * MINUTE_MS, now);
  const message = verifyEmailMessage({
    name: user.name,
    url: linkFor(VERIFY_EMAIL_PATH, token),
    ttlHours: VERIFY_EMAIL_TTL_HOURS,
  });
  await deliver(message, user.email, { userId: user._id, kind: VERIFY_EMAIL });
}

// Signed-in "resend verification email". Returns quietly during the cooldown so a double tap sends one email.
export async function resendVerificationEmail(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
  if (user.emailVerifiedAt) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.EMAIL_ALREADY_VERIFIED,
      "Your email is already verified",
    );
  }
  const now = new Date();
  if (await inCooldown(user._id, VERIFY_EMAIL, now)) return;
  await sendVerificationEmail(user, { now });
}

export async function verifyEmail({ token }) {
  const tokenHash = sha256(token);
  const now = new Date();
  const verified = await withTransaction(async (session) => {
    const consumed = await emailTokenRepository.consume(VERIFY_EMAIL, tokenHash, { session, now });
    if (!consumed) return false;
    const user = await userRepository.markEmailVerified(consumed.userId, consumed.email, {
      session,
      now,
    });
    // The account email changed since the link was sent; throwing rolls back, so the token is not spent.
    if (!user) throw invalidLink(INVALID_VERIFY);
    return true;
  });

  if (!verified) {
    // Opening the same link twice (or a mail scanner opening it first) is fine once the email is verified.
    const existing = await emailTokenRepository.findByTokenHash(VERIFY_EMAIL, tokenHash);
    const owner = existing?.usedAt && (await userRepository.findById(existing.userId));
    if (owner?.emailVerifiedAt && owner.email === existing.email) return { emailVerified: true };
    throw invalidLink(INVALID_VERIFY);
  }
  return { emailVerified: true };
}

// Work that must not delay the response; any failure is logged rather than surfaced.
function runInBackground(task, kind) {
  task().catch((error) => logger.error({ err: error, kind }, "Background email task failed"));
}

// Returns at once, whether or not the email has an account: the lookup and the SMTP round trip happen after the
// response, so neither the body nor the response time reveals whether the account exists.
export function requestPasswordReset({ email }) {
  runInBackground(() => processPasswordReset(email), RESET_PASSWORD);
}

// Signup should not wait on SMTP either.
export function queueVerificationEmail(user) {
  runInBackground(() => sendVerificationEmail(user), VERIFY_EMAIL);
}

async function processPasswordReset(email) {
  const user = await userRepository.findByEmail(email);
  if (!user) return;
  const now = new Date();
  if (await inCooldown(user._id, RESET_PASSWORD, now)) return;

  const token = await issueToken(user, RESET_PASSWORD, RESET_PASSWORD_TTL_MINUTES * MINUTE_MS, now);
  const message = resetPasswordMessage({
    name: user.name,
    url: linkFor(RESET_PASSWORD_PATH, token),
    ttlMinutes: RESET_PASSWORD_TTL_MINUTES,
  });
  await deliver(message, user.email, { userId: user._id, kind: RESET_PASSWORD });
}

// Lets the reset page say "link expired" before the user types a new password. It does not use up the link.
export async function checkResetToken({ token }) {
  const existing = await emailTokenRepository.findByTokenHash(RESET_PASSWORD, sha256(token));
  if (!existing || existing.usedAt || existing.expiresAt <= new Date()) {
    throw invalidLink(INVALID_RESET);
  }
}

// Sets the new password (or a first one, for Google-only accounts), verifies the email and signs out every device.
export async function resetPassword({ token, password }) {
  // A cheap lookup first, so random tokens cannot make the server run argon2.
  await checkResetToken({ token });
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const user = await withTransaction(async (session) => {
    const consumed = await emailTokenRepository.consume(RESET_PASSWORD, sha256(token), {
      session,
      now,
    });
    if (!consumed) throw invalidLink(INVALID_RESET);

    const updated = await userRepository.setPassword(consumed.userId, passwordHash, {
      session,
      now,
    });
    if (!updated) throw invalidLink(INVALID_RESET);
    await sessionRepository.revokeAllForUser(consumed.userId, "password_reset", { session, now });
    await emailTokenRepository.deleteUnused(consumed.userId, RESET_PASSWORD, { session });
    return updated;
  });

  logger.info({ userId: String(user._id) }, "Password reset; all sessions revoked");
  const message = passwordChangedMessage({
    name: user.name,
    url: `${env.APP_WEB_URL}/auth/forgot-password`,
  });
  await deliver(message, user.email, { userId: user._id, kind: "password_changed" });
}

// Signed-in change from Settings: proves the current password, then keeps this device and signs out the rest.
// Google-only accounts have no current password; they set one through the reset-link flow instead.
export async function changePassword(userId, currentSessionId, { currentPassword, newPassword }) {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
  if (!user.passwordHash) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.PASSWORD_NOT_SET,
      "This account has no password yet. Use Set password to get a link by email.",
    );
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ApiError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_CREDENTIALS,
      "Your current password is incorrect",
    );
  }
  if (newPassword === currentPassword) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "body.newPassword", message: "Choose a password different from your current one" }],
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  await withTransaction(async (session) => {
    await userRepository.updatePasswordHash(userId, passwordHash, { session });
    await sessionRepository.revokeOthersForUser(userId, currentSessionId, "password_change", {
      session,
      now,
    });
  });

  logger.info({ userId: String(userId) }, "Password changed; other sessions revoked");
  const message = passwordChangedMessage({
    name: user.name,
    url: `${env.APP_WEB_URL}/auth/forgot-password`,
    keptDevice: true,
  });
  runInBackground(
    () => deliver(message, user.email, { userId, kind: "password_changed" }),
    "password_changed",
  );
}
