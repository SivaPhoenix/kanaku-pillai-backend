import { HTTP_STATUS } from "../constants/http-status.js";
import * as statsService from "../services/stats.service.js";
import { ok } from "../utils/api-response.js";

export async function month(req, res) {
  ok(
    res,
    HTTP_STATUS.OK,
    await statsService.getMonthStats(req.user.id, req.validated.params.month),
  );
}

export async function period(req, res) {
  ok(res, HTTP_STATUS.OK, await statsService.getPeriodStats(req.user.id, req.validated.query));
}

export async function trend(req, res) {
  ok(res, HTTP_STATUS.OK, await statsService.getTrend(req.user.id, req.validated.query));
}
