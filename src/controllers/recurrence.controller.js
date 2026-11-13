import { HTTP_STATUS } from "../constants/http-status.js";
import * as recurrenceService from "../services/recurrence.service.js";
import { ok } from "../utils/api-response.js";

export async function list(req, res) {
  ok(res, HTTP_STATUS.OK, await recurrenceService.listRules(req.user.id));
}

export async function update(req, res) {
  const { id } = req.validated.params;
  ok(res, HTTP_STATUS.OK, await recurrenceService.updateRule(req.user.id, id, req.validated.body));
}

export async function remove(req, res) {
  await recurrenceService.stopRule(req.user.id, req.validated.params.id);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}
