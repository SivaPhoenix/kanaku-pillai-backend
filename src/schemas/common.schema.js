import mongoose from "mongoose";
import { z } from "zod";
import {
  CATEGORY_KINDS,
  COLORS,
  ICON_NAMES,
  RECURRENCE_FREQS,
  INSTALLMENT_MONTHS,
  TX_TYPES,
} from "../constants/enums.js";
import { isSupportedCurrency } from "../utils/money.js";
import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT } from "../utils/pagination.js";
import { isValidLocalDate, isValidMonth, isValidZone } from "../utils/time.js";

// Building blocks for every resource schema; keep request rules in one place.

export const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value), {
    message: "must be a valid id",
  });

export const idParams = z.object({ id: objectId }).strict();

export const localDate = z
  .string()
  .refine(isValidLocalDate, { message: "must be a date like 2026-10-22" });

export const month = z.string().refine(isValidMonth, { message: "must be a month like 2026-10" });

export const tzid = z.string().refine(isValidZone, { message: "must be an IANA time zone" });

export const currencyCode = z
  .string()
  .toUpperCase()
  .refine(isSupportedCurrency, { message: "must be an ISO 4217 currency code" });

export const amountMinor = z
  .number()
  .int("must be a whole number of minor units")
  .positive("must be greater than 0")
  .refine(Number.isSafeInteger, { message: "is too large" });

export const signedMinor = z
  .number()
  .int("must be a whole number of minor units")
  .refine(Number.isSafeInteger, { message: "is too large" });

export const nonNegativeMinor = signedMinor.refine((value) => value >= 0, {
  message: "cannot be negative",
});

export const icon = z.enum(ICON_NAMES, { error: "must be one of the supported icon names" });
export const color = z.enum(COLORS, { error: "must be c1 to c7" });
export const txType = z.enum(TX_TYPES);
export const categoryKind = z.enum(CATEGORY_KINDS);
export const note = z.string().trim().max(140, "must be at most 140 characters");

export const repeat = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(365).default(1),
    endsOn: localDate.nullable().optional(),
  })
  .strict();

export const instalments = z
  .object({
    months: z
      .number()
      .int()
      .refine((value) => INSTALLMENT_MONTHS.includes(value), { message: "must be 3, 6, 9 or 12" }),
  })
  .strict();

// Query strings arrive as text; "true"/"false" only, anything else is a 400.
export const booleanQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const pageQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
};

export const orderBody = z.object({ ids: z.array(objectId).min(1).max(500) }).strict();
