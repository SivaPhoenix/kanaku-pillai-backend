import { z } from "zod";
import { booleanQuery, categoryKind, color, icon, idParams, objectId } from "./common.schema.js";

const name = z.string().trim().min(1, "is required").max(40, "must be at most 40 characters");

export const createCategoryBody = z.object({ kind: categoryKind, name, icon, color }).strict();

export const updateCategoryBody = z
  .object({ name, icon, color })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field" });

export const listCategoriesQuery = z
  .object({ kind: categoryKind.optional(), includeArchived: booleanQuery })
  .strict();

export const categoryIdParams = idParams;

export const orderCategoriesBody = z
  .object({ kind: categoryKind, ids: z.array(objectId).min(1).max(500) })
  .strict();
