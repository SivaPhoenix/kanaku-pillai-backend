import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { ApiError } from "../utils/api-error.js";

const PARTS = ["params", "query", "body"];

// Usage: validate({ params, query, body }) with Zod schemas. Parsed values land on req.validated because req.query is read-only in Express 5.
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const details = [];

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ field: [part, ...issue.path].join("."), message: issue.message });
        }
      }
    }

    if (details.length > 0) {
      return next(
        new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          "Request validation failed",
          details,
        ),
      );
    }

    req.validated = validated;
    return next();
  };
}
