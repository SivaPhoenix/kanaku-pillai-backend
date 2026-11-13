import { z } from "zod";
import { THEMES, TZ_MODES, WEEK_STARTS } from "../constants/enums.js";
import { currencyCode, tzid } from "./common.schema.js";

const MAX_LOCALE_LENGTH = 35;

function isValidLocale(value) {
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

const locale = z
  .string()
  .max(MAX_LOCALE_LENGTH)
  .refine(isValidLocale, { message: "must be a BCP 47 language tag" });

export const updateProfileBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();

export const updateSettingsBody = z
  .object({
    currencyCode: currencyCode.optional(),
    locale: locale.optional(),
    tzMode: z.enum(TZ_MODES).optional(),
    tzid: tzid.optional(),
    theme: z.enum(THEMES).optional(),
    weekStart: z.enum(WEEK_STARTS).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "send at least one setting" });

export const deleteAccountBody = z
  .object({
    confirm: z.literal("DELETE", { error: 'must be exactly "DELETE"' }),
    password: z.string().min(1).max(256).optional(),
  })
  .strict();
