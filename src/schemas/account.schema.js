import { z } from "zod";
import { ACCOUNT_TYPES } from "../constants/enums.js";
import {
  amountMinor,
  booleanQuery,
  color,
  icon,
  idParams,
  month,
  objectId,
  orderBody,
  signedMinor,
} from "./common.schema.js";

const day = z.number().int().min(1).max(28);

const fields = {
  name: z.string().trim().min(1, "is required").max(40, "must be at most 40 characters"),
  type: z.enum(ACCOUNT_TYPES),
  icon,
  color,
  last4: z
    .string()
    .regex(/^\d{4}$/, "must be 4 digits")
    .nullish(),
  openingBalanceMinor: signedMinor,
  linkedAccountId: objectId.nullish(),
  creditLimitMinor: amountMinor.nullish(),
  statementDay: day.nullish(),
  dueDay: day.nullish(),
};

export const createAccountBody = z
  .object({ ...fields, openingBalanceMinor: fields.openingBalanceMinor.optional() })
  .strict();

export const updateAccountBody = z
  .object(fields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field" });

export const listAccountsQuery = z.object({ includeArchived: booleanQuery }).strict();

export const getAccountQuery = z.object({ month: month.optional() }).strict();

export const accountIdParams = idParams;

export const orderAccountsBody = orderBody;
