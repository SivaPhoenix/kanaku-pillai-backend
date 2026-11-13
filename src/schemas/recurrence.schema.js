import { z } from "zod";
import { amountMinor, localDate, note } from "./common.schema.js";

export const patchRecurrenceBody = z
  .object({
    amountMinor: amountMinor.optional(),
    note: note.nullable().optional(),
    endsOn: localDate.nullable().optional(),
    paused: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "must include at least one field" });
