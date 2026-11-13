import { createHash } from "node:crypto";
import { z } from "zod";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as idempotencyRepository from "../repositories/idempotency.repository.js";
import { ApiError } from "../utils/api-error.js";

const HEADER = "Idempotency-Key";
const keySchema = z.uuid();

function hashRequest(req) {
  return createHash("sha256")
    .update(`${req.method} ${req.baseUrl}${req.path}\n${JSON.stringify(req.body ?? null)}`)
    .digest("hex");
}

// Optional Idempotency-Key support for creates (after requireAuth). Same key + same body within 24 h replays the
// stored response; a different body is 409; a request still running is 409. Failed requests release the key.
export async function idempotency(req, res, next) {
  const key = req.get(HEADER);
  if (!key) return next();
  if (!keySchema.safeParse(key).success) {
    return next(
      new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        "Request validation failed",
        [{ field: "headers.idempotency-key", message: "must be a UUID" }],
      ),
    );
  }

  const userId = req.user.id;
  const requestHash = hashRequest(req);
  const { claimed, existing } = await idempotencyRepository.claim(userId, {
    key,
    route: `${req.method} ${req.baseUrl}${req.path}`,
    requestHash,
  });

  if (!claimed) {
    if (existing.requestHash !== requestHash) {
      return next(
        new ApiError(
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
          "This Idempotency-Key was already used for a different request",
        ),
      );
    }
    if (existing.status !== "completed") {
      return next(
        new ApiError(
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
          "The original request is still being processed",
        ),
      );
    }
    res.set("Idempotent-Replayed", "true");
    return res.status(existing.responseStatus).json(existing.responseBody);
  }

  // Store successful responses; release the key on errors so the client can retry with it.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const task =
      res.statusCode < 400
        ? idempotencyRepository.complete(userId, key, {
            responseStatus: res.statusCode,
            responseBody: body,
          })
        : idempotencyRepository.release(userId, key);
    task.catch((error) => req.log?.error({ err: error }, "Idempotency bookkeeping failed"));
    return originalJson(body);
  };
  return next();
}
