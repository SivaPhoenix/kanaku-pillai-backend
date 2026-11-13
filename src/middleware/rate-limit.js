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

// Limits a route per client IP (IPv6 grouped by /56), optionally per IP + submitted email.
export function createRateLimit({ name, windowMs, limit, byEmail = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new MongoRateLimitStore(`rl:${name}`),
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? "unknown");
      return byEmail ? `${ip}:${emailPart(req)}` : ip;
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
  login: createRateLimit({ name: "login", windowMs: 15 * MINUTE, limit: 10, byEmail: true }),
  google: createRateLimit({ name: "google", windowMs: 15 * MINUTE, limit: 20 }),
  refresh: createRateLimit({ name: "refresh", windowMs: 15 * MINUTE, limit: 60 }),
});
