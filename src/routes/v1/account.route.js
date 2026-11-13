import { Router } from "express";
import * as accountController from "../../controllers/account.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import {
  accountIdParams,
  createAccountBody,
  getAccountQuery,
  listAccountsQuery,
  orderAccountsBody,
  updateAccountBody,
} from "../../schemas/account.schema.js";

export const accountRouter = Router();

accountRouter.use(requireAuth, writeRateLimit);

accountRouter.get("/", validate({ query: listAccountsQuery }), accountController.list);
accountRouter.get("/summary", accountController.summary);
accountRouter.put("/order", validate({ body: orderAccountsBody }), accountController.reorder);
accountRouter.post("/", validate({ body: createAccountBody }), accountController.create);
accountRouter.get(
  "/:id",
  validate({ params: accountIdParams, query: getAccountQuery }),
  accountController.get,
);
accountRouter.patch(
  "/:id",
  validate({ params: accountIdParams, body: updateAccountBody }),
  accountController.update,
);
accountRouter.post(
  "/:id/archive",
  validate({ params: accountIdParams }),
  accountController.archive,
);
accountRouter.post(
  "/:id/unarchive",
  validate({ params: accountIdParams }),
  accountController.unarchive,
);
accountRouter.post(
  "/:id/default",
  validate({ params: accountIdParams }),
  accountController.makeDefault,
);
accountRouter.delete("/:id", validate({ params: accountIdParams }), accountController.remove);
