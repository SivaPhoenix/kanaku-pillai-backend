import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { ApiError } from "../utils/api-error.js";

// body-parser reports its failures through err.type; map them to client errors instead of 500s.
const BODY_PARSER_ERRORS = {
  "entity.parse.failed": [
    HTTP_STATUS.BAD_REQUEST,
    ERROR_CODES.INVALID_JSON,
    "Request body is not valid JSON",
  ],
  "entity.too.large": [
    HTTP_STATUS.PAYLOAD_TOO_LARGE,
    ERROR_CODES.PAYLOAD_TOO_LARGE,
    "Request body is too large",
  ],
  "charset.unsupported": [
    HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
    ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    "Unsupported charset",
  ],
  "encoding.unsupported": [
    HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
    ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    "Unsupported content encoding",
  ],
};

function toApiError(error) {
  if (error instanceof ApiError) return error;
  const known = BODY_PARSER_ERRORS[error?.type];
  return known ? new ApiError(...known) : null;
}

// Express recognises error middleware by its four parameters, so next must stay in the signature.
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let apiError = toApiError(error);
  if (!apiError) {
    req.log?.error({ err: error }, "Unhandled error");
    apiError = new ApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL,
      "Something went wrong",
    );
  }

  return res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details && { details: apiError.details }),
      requestId: req.requestId,
    },
  });
}
