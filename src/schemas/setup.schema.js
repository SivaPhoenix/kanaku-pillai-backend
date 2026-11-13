import { z } from "zod";
import { currencyCode, nonNegativeMinor, tzid } from "./common.schema.js";

const startingBalances = z
  .object({
    savingsMinor: nonNegativeMinor.optional(),
    walletMinor: nonNegativeMinor.optional(),
    creditCardOwedMinor: nonNegativeMinor.optional(),
  })
  .strict();

export const setupBody = z
  .object({
    currencyCode,
    tzid,
    startingBalances: startingBalances.optional(),
    starterCategories: z.boolean().default(true),
  })
  .strict();
