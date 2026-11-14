import {
  CLIENT_PLATFORM_HEADER,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from "../constants/auth.js";
import { CLIENT_PLATFORMS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { env } from "../config/env.js";
import * as authService from "../services/auth.service.js";
import * as emailAuthService from "../services/email-auth.service.js";
import { ApiError } from "../utils/api-error.js";
import { ok } from "../utils/api-response.js";

function clientPlatform(req) {
  const value = (req.get(CLIENT_PLATFORM_HEADER) ?? "web").toLowerCase();
  if (!CLIENT_PLATFORMS.includes(value)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "headers.x-client-platform", message: "must be web, ios or android" }],
    );
  }
  return value;
}

function context(req) {
  return {
    platform: clientPlatform(req),
    meta: { ipAddress: req.ip, userAgent: req.get("user-agent") },
  };
}

const cookieBase = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: REFRESH_COOKIE_PATH,
});

// Web keeps the refresh token in an httpOnly cookie that page scripts cannot read; without "keep me signed in" it is a browser-session cookie.
function setRefreshCookie(res, tokens) {
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...cookieBase(),
    ...(tokens.keepSignedIn && { expires: tokens.refreshTokenExpiresAt }),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieBase());
}

function tokenBody(res, platform, tokens) {
  const body = {
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
  };
  if (platform === "web") {
    setRefreshCookie(res, tokens);
  } else {
    body.refreshToken = tokens.refreshToken;
    body.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt.toISOString();
  }
  return body;
}

function readRefreshToken(req, platform) {
  return platform === "web" ? req.cookies?.[REFRESH_COOKIE_NAME] : req.validated.body.refreshToken;
}

export async function signup(req, res) {
  const ctx = context(req);
  const { user, tokens, isNewUser } = await authService.signup(req.validated.body, ctx);
  ok(res, HTTP_STATUS.CREATED, { user, ...tokenBody(res, ctx.platform, tokens), isNewUser });
}

export async function login(req, res) {
  const ctx = context(req);
  const { user, tokens } = await authService.login(req.validated.body, ctx);
  ok(res, HTTP_STATUS.OK, { user, ...tokenBody(res, ctx.platform, tokens) });
}

export async function google(req, res) {
  const ctx = context(req);
  const { user, tokens, isNewUser } = await authService.signInWithGoogle(req.validated.body, ctx);
  ok(res, isNewUser ? HTTP_STATUS.CREATED : HTTP_STATUS.OK, {
    user,
    ...tokenBody(res, ctx.platform, tokens),
    isNewUser,
  });
}

export async function refresh(req, res) {
  const platform = clientPlatform(req);
  try {
    const tokens = await authService.refresh({ refreshToken: readRefreshToken(req, platform) });
    ok(res, HTTP_STATUS.OK, tokenBody(res, platform, tokens));
  } catch (error) {
    if (platform === "web") clearRefreshCookie(res);
    throw error;
  }
}

export async function logout(req, res) {
  const platform = clientPlatform(req);
  await authService.logout({ refreshToken: readRefreshToken(req, platform) });
  if (platform === "web") clearRefreshCookie(res);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function verifyEmail(req, res) {
  ok(res, HTTP_STATUS.OK, await emailAuthService.verifyEmail(req.validated.body));
}

export function forgotPassword(req, res) {
  emailAuthService.requestPasswordReset(req.validated.body);
  res.status(HTTP_STATUS.ACCEPTED).end();
}

export async function checkResetToken(req, res) {
  await emailAuthService.checkResetToken(req.validated.body);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function changePassword(req, res) {
  await emailAuthService.changePassword(req.user.id, req.user.sessionId, req.validated.body);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function resetPassword(req, res) {
  await emailAuthService.resetPassword(req.validated.body);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}
