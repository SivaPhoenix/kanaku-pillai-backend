import { Router } from "express";
import * as statsController from "../../controllers/stats.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { monthParams, periodQuery, trendQuery } from "../../schemas/stats.schema.js";

export const statsRouter = Router();

statsRouter.use(requireAuth, writeRateLimit);
statsRouter.get("/month/:month", validate({ params: monthParams }), statsController.month);
statsRouter.get("/period", validate({ query: periodQuery }), statsController.period);
statsRouter.get("/trend", validate({ query: trendQuery }), statsController.trend);
