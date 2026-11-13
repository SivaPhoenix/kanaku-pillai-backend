import { Router } from "express";
import * as meController from "../../controllers/me.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export const meRouter = Router();

meRouter.get("/", requireAuth, meController.getMe);
