import { Router } from "express";
import * as setupController from "../../controllers/setup.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { setupBody } from "../../schemas/setup.schema.js";

export const setupRouter = Router();

setupRouter.use(requireAuth, writeRateLimit);

setupRouter.post("/", validate({ body: setupBody }), setupController.setup);
