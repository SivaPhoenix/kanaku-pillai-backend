import { z } from "zod";
import {
  amountMinor,
  idParams,
  instalments,
  localDate,
  note,
  objectId,
  pageQuery,
  repeat,
  txType,
  tzid,
} from "./common.schema.js";

export { idParams };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 366 * DAY_MS;
const MAX_PAST_MS = 3653 * DAY_MS;

// ISO-8601 instant → Date, within the last 10 years and at most one year ahead.
const occurredAt = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((date) => date.getTime() <= Date.now() + MAX_FUTURE_MS, {
    message: "cannot be more than one year in the future",
  })
  .refine((date) => date.getTime() >= Date.now() - MAX_PAST_MS, {
    message: "cannot be more than 10 years in the past",
  });

export const createBody = z
  .object({
    type: txType,
    amountMinor,
    categoryId: objectId.nullable().optional(),
    accountId: objectId,
    toAccountId: objectId.nullable().optional(),
    occurredAt,
    tzid,
    note: note.nullable().optional(),
    repeat: repeat.optional(),
    instalments: instalments.optional(),
  })
  .strict();

export const patchBody = z
  .object({
    type: txType.optional(),
    amountMinor: amountMinor.optional(),
    categoryId: objectId.nullable().optional(),
    accountId: objectId.optional(),
    toAccountId: objectId.nullable().optional(),
    occurredAt: occurredAt.optional(),
    tzid: tzid.optional(),
    note: note.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field" });

export const duplicateBody = z
  .object({ occurredAt: occurredAt.optional(), tzid: tzid.optional() })
  .strict();

const filterShape = {
  from: localDate.optional(),
  to: localDate.optional(),
  type: txType.optional(),
  accountId: objectId.optional(),
  categoryId: objectId.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  min: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  max: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
};

function checkRanges(query, ctx) {
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "must not be after to" });
  }
  if (query.min !== undefined && query.max !== undefined && query.min > query.max) {
    ctx.addIssue({ code: "custom", path: ["min"], message: "must not be above max" });
  }
}

export const filterQuery = z.object(filterShape).strict().superRefine(checkRanges);
export const listQuery = z
  .object({ ...filterShape, ...pageQuery })
  .strict()
  .superRefine(checkRanges);
export const dayParams = z.object({ localDate }).strict();
