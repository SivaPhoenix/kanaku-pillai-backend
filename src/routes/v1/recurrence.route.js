import { Router } from "express";
import * as recurrenceController from "../../controllers/recurrence.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { idParams } from "../../schemas/common.schema.js";
import { patchRecurrenceBody } from "../../schemas/recurrence.schema.js";

export const recurrenceRouter = Router();

recurrenceRouter.use(requireAuth, writeRateLimit);
recurrenceRouter.get("/", recurrenceController.list);
recurrenceRouter.patch(
  "/:id",
  validate({ params: idParams, body: patchRecurrenceBody }),
  recurrenceController.update,
);
recurrenceRouter.delete("/:id", validate({ params: idParams }), recurrenceController.remove);
