import { Router } from "express";
import * as categoryController from "../../controllers/category.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import {
  categoryIdParams,
  createCategoryBody,
  listCategoriesQuery,
  orderCategoriesBody,
  updateCategoryBody,
} from "../../schemas/category.schema.js";

export const categoryRouter = Router();

categoryRouter.use(requireAuth, writeRateLimit);

categoryRouter.get("/", validate({ query: listCategoriesQuery }), categoryController.list);
categoryRouter.put("/order", validate({ body: orderCategoriesBody }), categoryController.reorder);
categoryRouter.post("/", validate({ body: createCategoryBody }), categoryController.create);
categoryRouter.patch(
  "/:id",
  validate({ params: categoryIdParams, body: updateCategoryBody }),
  categoryController.update,
);
categoryRouter.post(
  "/:id/archive",
  validate({ params: categoryIdParams }),
  categoryController.archive,
);
categoryRouter.post(
  "/:id/unarchive",
  validate({ params: categoryIdParams }),
  categoryController.unarchive,
);
categoryRouter.delete("/:id", validate({ params: categoryIdParams }), categoryController.remove);
