import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as rateLimitRepository from "../repositories/rate-limit.repository.js";
import { ApiError } from "../utils/api-error.js";

// express-rate-limit store backed by MongoDB, so every API instance shares the same counters.
class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  increment(key) {
    return rateLimitRepository.increment(`${this.prefix}:${key}`, this.windowMs);
  }

  decrement(key) {
    return rateLimitRepository.decrement(`${this.prefix}:${key}`);
  }

  resetKey(key) {
    return rateLimitRepository.reset(`${this.prefix}:${key}`);
  }
}

function emailPart(req) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email.slice(0, 254);
}

// Limits a route per client IP (IPv6 grouped by /56), per IP + submitted email, or per signed-in user.
export function createRateLimit({ name, windowMs, limit, keyBy = "ip" }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new MongoRateLimitStore(`rl:${name}`),
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? "unknown");
      if (keyBy === "ip+email") return `${ip}:${emailPart(req)}`;
      // "user" needs requireAuth to have run first; without it the limit falls back to the IP.
      if (keyBy === "user") return req.user?.id ? `user:${req.user.id}` : ip;
      return ip;
    },
    handler: (_req, _res, next, options) => {
      next(
        new ApiError(
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.RATE_LIMITED,
          `Too many attempts. Try again in ${Math.ceil(options.windowMs / 60000)} minutes.`,
        ),
      );
    },
  });
}

const MINUTE = 60 * 1000;

export const authRateLimits = Object.freeze({
  signup: createRateLimit({ name: "signup", windowMs: 60 * MINUTE, limit: 10 }),
  login: createRateLimit({ name: "login", windowMs: 15 * MINUTE, limit: 10, keyBy: "ip+email" }),
  google: createRateLimit({ name: "google", windowMs: 15 * MINUTE, limit: 20 }),
  refresh: createRateLimit({ name: "refresh", windowMs: 15 * MINUTE, limit: 60 }),
  forgotPassword: createRateLimit({
    name: "forgot-password",
    windowMs: 15 * MINUTE,
    limit: 5,
    keyBy: "ip+email",
  }),
  // Caps one IP looping over many addresses, which would otherwise burn the sender's daily quota for everyone.
  forgotPasswordPerIp: createRateLimit({
    name: "forgot-password-ip",
    windowMs: 60 * MINUTE,
    limit: 20,
  }),
  resetPassword: createRateLimit({ name: "reset-password", windowMs: 15 * MINUTE, limit: 20 }),
  verifyEmail: createRateLimit({ name: "verify-email", windowMs: 15 * MINUTE, limit: 20 }),
});

export const resendVerificationRateLimit = createRateLimit({
  name: "resend-verification",
  windowMs: 15 * MINUTE,
  limit: 5,
  keyBy: "user",
});

// Caps guessing the current password from a stolen session.
export const changePasswordRateLimit = createRateLimit({
  name: "change-password",
  windowMs: 15 * MINUTE,
  limit: 5,
  keyBy: "user",
});

// Per-user limits for authenticated routes (mount after requireAuth).
export const deleteAccountRateLimit = createRateLimit({
  name: "delete-account",
  windowMs: 15 * MINUTE,
  limit: 5,
  keyBy: "user",
});

export const exportRateLimit = createRateLimit({
  name: "export",
  windowMs: 15 * MINUTE,
  limit: 10,
  keyBy: "user",
});

const writeLimiter = createRateLimit({
  name: "write",
  windowMs: 5 * MINUTE,
  limit: 300,
  keyBy: "user",
});
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// General write limit for signed-in users; reads pass untouched.
export function writeRateLimit(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  return writeLimiter(req, res, next);
}
