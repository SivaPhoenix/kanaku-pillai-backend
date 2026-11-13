import { Router } from "express";
import * as meController from "../../controllers/me.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { deleteAccountRateLimit, writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { idParams } from "../../schemas/common.schema.js";
import {
  deleteAccountBody,
  updateProfileBody,
  updateSettingsBody,
} from "../../schemas/me.schema.js";

export const meRouter = Router();

meRouter.use(requireAuth, writeRateLimit);

meRouter.get("/", meController.getMe);
meRouter.patch("/", validate({ body: updateProfileBody }), meController.updateProfile);
meRouter.patch("/settings", validate({ body: updateSettingsBody }), meController.updateSettings);
meRouter.get("/sessions", meController.listSessions);
meRouter.delete("/sessions/:id", validate({ params: idParams }), meController.revokeSession);
meRouter.delete(
  "/",
  deleteAccountRateLimit,
  validate({ body: deleteAccountBody }),
  meController.deleteAccount,
);
