import { Router } from "express";
import * as favouriteController from "../../controllers/favourite.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { createFavouriteBody, patchFavouriteBody } from "../../schemas/favourite.schema.js";
import { idParams, orderBody } from "../../schemas/common.schema.js";

export const favouriteRouter = Router();

favouriteRouter.use(requireAuth, writeRateLimit);
favouriteRouter.get("/", favouriteController.list);
favouriteRouter.post("/", validate({ body: createFavouriteBody }), favouriteController.create);
favouriteRouter.put("/order", validate({ body: orderBody }), favouriteController.reorder);
favouriteRouter.patch(
  "/:id",
  validate({ params: idParams, body: patchFavouriteBody }),
  favouriteController.update,
);
favouriteRouter.delete("/:id", validate({ params: idParams }), favouriteController.remove);
