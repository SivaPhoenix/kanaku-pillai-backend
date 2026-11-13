import { HTTP_STATUS } from "../constants/http-status.js";
import * as setupService from "../services/setup.service.js";
import { ok } from "../utils/api-response.js";

export async function setup(req, res) {
  ok(res, HTTP_STATUS.CREATED, await setupService.completeSetup(req.user.id, req.validated.body));
}
