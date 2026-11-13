import { HTTP_STATUS } from "../constants/http-status.js";
import { getReadiness } from "../services/health.service.js";
import { ok } from "../utils/api-response.js";

export function live(_req, res) {
  ok(res, HTTP_STATUS.OK, { status: "ok" });
}

export function ready(_req, res) {
  const { ready: isReady, checks } = getReadiness();
  ok(res, isReady ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE, {
    status: isReady ? "ok" : "unavailable",
    checks,
  });
}
