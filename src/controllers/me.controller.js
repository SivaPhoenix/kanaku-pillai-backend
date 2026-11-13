import { HTTP_STATUS } from "../constants/http-status.js";
import * as userService from "../services/user.service.js";
import { ok } from "../utils/api-response.js";

export async function getMe(req, res) {
  ok(res, HTTP_STATUS.OK, await userService.getMe(req.user.id));
}
