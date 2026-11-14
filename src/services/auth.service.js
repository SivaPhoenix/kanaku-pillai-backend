import mongoose from "mongoose";
import { SHORT_SESSION_DAYS } from "../constants/auth.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  GoogleTokenError,
  isGoogleSignInConfigured,
  verifyGoogleIdToken,
} from "../integrations/google/id-token-verifier.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { generateToken, sha256 } from "../utils/crypto.js";
import { isTokenExpiredError, signAccessToken, verifyAccessToken } from "../utils/jwt.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../utils/password.js";
import { isDuplicateKeyError, withTransaction } from "../utils/transaction.js";
import { queueVerificationEmail } from "./email-auth.service.js";
import { toUserDto } from "./user.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const unauthenticated = (message = "Sign in again to continue") =>
  new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, message);

const invalidCredentials = () =>
  new ApiError(
    HTTP_STATUS.UNAUTHORIZED,
    ERROR_CODES.INVALID_CREDENTIALS,
    "Email or password is incorrect",
  );

const emailTaken = () =>
  new ApiError(
    HTTP_STATUS.CONFLICT,
    ERROR_CODES.EMAIL_TAKEN,
    "An account with this email already exists. Sign in instead.",
  );

function sessionExpiry(keepSignedIn, now) {
  const days = keepSignedIn ? env.REFRESH_TOKEN_TTL_DAYS : SHORT_SESSION_DAYS;
  return new Date(now.getTime() + days * DAY_MS);
}

// Native apps always stay signed in; only the web offers "keep me signed in".
function resolveKeepSignedIn(platform, keepSignedIn) {
  return platform === "web" ? keepSignedIn : true;
}

async function issueSession(user, { platform, keepSignedIn, meta }, { session } = {}) {
  const now = new Date();
  const refreshToken = generateToken();
  const keep = resolveKeepSignedIn(platform, keepSignedIn);
  const created = await sessionRepository.create(
    user._id,
    {
      tokenHash: sha256(refreshToken),
      platform,
      userAgent: meta.userAgent?.slice(0, 512),
      ipAddress: meta.ipAddress?.slice(0, 64),
      keepSignedIn: keep,
      lastUsedAt: now,
      expiresAt: sessionExpiry(keep, now),
    },
    { session },
  );

  return {
    accessToken: signAccessToken({ userId: String(user._id), sessionId: String(created._id) }),
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresAt: created.expiresAt,
    keepSignedIn: keep,
  };
}

export async function signup({ name, email, password }, context) {
  if (await userRepository.findByEmail(email)) throw emailTaken();

  const passwordHash = await hashPassword(password);
  let created;
  try {
    created = await withTransaction(async (session) => {
      const user = await userRepository.create({ name, email, passwordHash }, { session });
      const tokens = await issueSession(user, { ...context, keepSignedIn: true }, { session });
      return { user, tokens };
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw emailTaken();
    throw error;
  }
  queueVerificationEmail(created.user);
  return {
    user: toUserDto(created.user, { hasPassword: true }),
    tokens: created.tokens,
    isNewUser: true,
  };
}

export async function login({ email, password, keepSignedIn }, context) {
  const user = await userRepository.findByEmail(email, { withPassword: true });
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();

  const tokens = await issueSession(user, { ...context, keepSignedIn });
  return { user: toUserDto(user, { hasPassword: true }), tokens };
}

// Account resolution rules: docs/auth/google-sign-in.md section 4.
export async function signInWithGoogle({ idToken }, context) {
  if (!isGoogleSignInConfigured()) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.GOOGLE_SIGN_IN_UNAVAILABLE,
      "Google sign-in is not configured",
    );
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(idToken);
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.GOOGLE_TOKEN_INVALID,
        "Google sign-in failed. Try again.",
      );
    }
    throw error;
  }

  if (!profile.email || !profile.emailVerified) {
    throw new ApiError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.GOOGLE_EMAIL_NOT_VERIFIED,
      "Your Google account email is not verified",
    );
  }

  const email = profile.email.toLowerCase();
  const now = new Date();

  try {
    return await withTransaction(async (session) => {
      const bySub = await userRepository.findByGoogleSub(profile.sub, { session });
      if (bySub) {
        const hasPassword = Boolean(await userRepository.hasPassword(bySub._id, { session }));
        const tokens = await issueSession(bySub, { ...context, keepSignedIn: true }, { session });
        return { user: toUserDto(bySub, { hasPassword }), tokens, isNewUser: false };
      }

      const byEmail = await userRepository.findByEmail(email, { withPassword: true, session });
      if (byEmail) {
        // An unverified password account with this email may have been created by someone else; Google proves ownership, so that password goes and its sessions end.
        const removePassword = Boolean(byEmail.passwordHash) && !byEmail.emailVerifiedAt;
        const linked = await userRepository.linkGoogle(
          byEmail._id,
          {
            googleSub: profile.sub,
            avatarUrl: byEmail.avatarUrl ? undefined : profile.picture,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? now,
            removePassword,
          },
          { session },
        );
        if (removePassword) {
          await sessionRepository.revokeAllForUser(byEmail._id, "account_takeover_guard", {
            session,
          });
          logger.warn(
            { userId: String(byEmail._id) },
            "Google sign-in replaced an unverified password",
          );
        }
        const tokens = await issueSession(linked, { ...context, keepSignedIn: true }, { session });
        const hasPassword = Boolean(byEmail.passwordHash) && !removePassword;
        return { user: toUserDto(linked, { hasPassword }), tokens, isNewUser: false };
      }

      const created = await userRepository.create(
        {
          name: profile.name?.trim().slice(0, 80) || email.split("@")[0],
          email,
          googleSub: profile.sub,
          emailVerifiedAt: now,
          avatarUrl: profile.picture,
        },
        { session },
      );
      const tokens = await issueSession(created, { ...context, keepSignedIn: true }, { session });
      return { user: toUserDto(created, { hasPassword: false }), tokens, isNewUser: true };
    });
  } catch (error) {
    // Two first-time sign-ins racing for the same account: the loser simply retries.
    if (isDuplicateKeyError(error)) {
      throw new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.CONFLICT, "Please try signing in again");
    }
    throw error;
  }
}

export async function refresh({ refreshToken }) {
  if (!refreshToken) throw unauthenticated();

  const tokenHash = sha256(refreshToken);
  const current = await sessionRepository.findByTokenHash(tokenHash);

  if (!current) {
    // An already-rotated token coming back means it was copied; end that session so neither copy keeps working.
    const replayed = await sessionRepository.findByPreviousTokenHash(tokenHash);
    if (replayed && !replayed.revokedAt) {
      await sessionRepository.revoke(replayed.userId, replayed._id, "reuse_detected");
      logger.warn(
        { userId: String(replayed.userId), sessionId: String(replayed._id) },
        "Refresh token reuse detected; session revoked",
      );
    }
    throw unauthenticated();
  }

  const now = new Date();
  if (current.revokedAt || current.expiresAt <= now) throw unauthenticated();

  const nextToken = generateToken();
  const rotated = await sessionRepository.rotate(current.userId, current._id, {
    currentTokenHash: tokenHash,
    nextTokenHash: sha256(nextToken),
    expiresAt: sessionExpiry(current.keepSignedIn, now),
    now,
  });
  if (!rotated) throw unauthenticated();

  return {
    accessToken: signAccessToken({
      userId: String(rotated.userId),
      sessionId: String(rotated._id),
    }),
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: nextToken,
    refreshTokenExpiresAt: rotated.expiresAt,
    keepSignedIn: rotated.keepSignedIn,
  };
}

export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  const current = await sessionRepository.findByTokenHash(sha256(refreshToken));
  if (current) await sessionRepository.revoke(current.userId, current._id, "logout");
}

// Used by the auth middleware: a valid signature is not enough, the session must still be active (sign-out takes effect at once).
export async function authenticateAccessToken(accessToken) {
  let claims;
  try {
    claims = verifyAccessToken(accessToken);
  } catch (error) {
    if (isTokenExpiredError(error)) {
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.TOKEN_EXPIRED,
        "Access token expired",
      );
    }
    throw unauthenticated();
  }

  if (!mongoose.isValidObjectId(claims.userId) || !mongoose.isValidObjectId(claims.sessionId)) {
    throw unauthenticated();
  }

  const session = await sessionRepository.findActive(claims.userId, claims.sessionId);
  if (!session) throw unauthenticated();

  return { id: claims.userId, sessionId: claims.sessionId };
}
