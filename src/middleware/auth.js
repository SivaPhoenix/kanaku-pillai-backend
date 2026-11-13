import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { authenticateAccessToken } from "../services/auth.service.js";
import { ApiError } from "../utils/api-error.js";

// Requires "Authorization: Bearer <accessToken>" and sets req.user = { id, sessionId }.
export async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(
      new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, "Sign in to continue"),
    );
  }
  req.user = await authenticateAccessToken(token);
  return next();
}
