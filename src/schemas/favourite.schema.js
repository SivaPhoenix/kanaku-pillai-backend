import { z } from "zod";
import { amountMinor, icon, note, objectId, txType } from "./common.schema.js";

const title = z.string().trim().min(1, "is required").max(40, "must be at most 40 characters");

export const createFavouriteBody = z
  .object({
    title,
    icon,
    type: txType,
    amountMinor,
    categoryId: objectId.nullish(),
    accountId: objectId,
    toAccountId: objectId.nullish(),
    note: note.nullish(),
  })
  .strict();

export const patchFavouriteBody = createFavouriteBody
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "must include at least one field" });
