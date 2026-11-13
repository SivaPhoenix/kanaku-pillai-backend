import { Router } from "express";
import * as transactionController from "../../controllers/transaction.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { exportRateLimit, writeRateLimit } from "../../middleware/rate-limit.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validate } from "../../middleware/validate.js";
import {
  createBody,
  dayParams,
  duplicateBody,
  filterQuery,
  idParams,
  listQuery,
  patchBody,
} from "../../schemas/transaction.schema.js";

export const transactionRouter = Router();

transactionRouter.use(requireAuth, writeRateLimit);

transactionRouter.get("/", validate({ query: listQuery }), transactionController.list);
transactionRouter.get("/summary", validate({ query: filterQuery }), transactionController.summary);
transactionRouter.get(
  "/day/:localDate",
  validate({ params: dayParams }),
  transactionController.day,
);
transactionRouter.get(
  "/export.csv",
  exportRateLimit,
  validate({ query: filterQuery }),
  transactionController.exportCsv,
);
transactionRouter.post(
  "/",
  validate({ body: createBody }),
  idempotency,
  transactionController.create,
);
transactionRouter.get("/:id", validate({ params: idParams }), transactionController.get);
transactionRouter.patch(
  "/:id",
  validate({ params: idParams, body: patchBody }),
  transactionController.update,
);
transactionRouter.delete("/:id", validate({ params: idParams }), transactionController.remove);
transactionRouter.post(
  "/:id/restore",
  validate({ params: idParams }),
  transactionController.restore,
);
transactionRouter.post(
  "/:id/duplicate",
  validate({ params: idParams, body: duplicateBody }),
  idempotency,
  transactionController.duplicate,
);
