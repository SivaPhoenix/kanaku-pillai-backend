import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { ApiError } from "../utils/api-error.js";

export function notFound(req, _res, next) {
  next(
    new ApiError(
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      `Route ${req.method} ${req.path} not found`,
    ),
  );
}
