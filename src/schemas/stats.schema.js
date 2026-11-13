import { z } from "zod";
import { localDate, month } from "./common.schema.js";

const statType = z.enum(["expense", "income"]).default("expense");

export const monthParams = z.object({ month }).strict();

export const periodQuery = z
  .object({
    period: z.enum(["week", "month", "year"]),
    ref: localDate.optional(),
    type: statType,
  })
  .strict();

export const trendQuery = z
  .object({
    months: z.enum(["6", "12"]).default("6").transform(Number),
    end: month.optional(),
    type: statType,
  })
  .strict();
