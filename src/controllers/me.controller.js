import { HTTP_STATUS } from "../constants/http-status.js";
import * as meService from "../services/me.service.js";
import * as userService from "../services/user.service.js";
import { ok } from "../utils/api-response.js";

export async function getMe(req, res) {
  ok(res, HTTP_STATUS.OK, await userService.getMe(req.user.id));
}

export async function updateProfile(req, res) {
  ok(res, HTTP_STATUS.OK, await meService.updateProfile(req.user.id, req.validated.body));
}

export async function updateSettings(req, res) {
  ok(res, HTTP_STATUS.OK, await meService.updateSettings(req.user.id, req.validated.body));
}

export async function listSessions(req, res) {
  ok(res, HTTP_STATUS.OK, await meService.listSessions(req.user.id, req.user.sessionId));
}

export async function revokeSession(req, res) {
  await meService.revokeSession(req.user.id, req.validated.params.id);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}

export async function deleteAccount(req, res) {
  await meService.deleteAccount(req.user.id, req.validated.body);
  res.status(HTTP_STATUS.NO_CONTENT).end();
}
