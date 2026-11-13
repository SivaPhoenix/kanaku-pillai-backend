import { describe, expect, it } from "vitest";
import { computeBalances, summarize } from "../../src/utils/balances.js";
import {
  minorDigits,
  parseQueryAmount,
  percentOf,
  splitInstalments,
  toDecimalString,
} from "../../src/utils/money.js";
import {
  addMonthsClamped,
  daysOfMonth,
  instantAt,
  localDateOf,
  nextOccurrenceDate,
  periodRanges,
  weekRange,
} from "../../src/utils/time.js";

describe("money", () => {
  it("knows minor digits per currency", () => {
    expect(minorDigits("INR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  it("splits instalments so the parts sum exactly, remainder first", () => {
    expect(splitInstalments(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(splitInstalments(1200, 12).reduce((a, b) => a + b, 0)).toBe(1200);
    expect(splitInstalments(7, 6)).toEqual([2, 1, 1, 1, 1, 1]);
  });

  it("formats decimals for CSV without floats", () => {
    expect(toDecimalString(123456, "INR")).toBe("1234.56");
    expect(toDecimalString(5, "INR")).toBe("0.05");
    expect(toDecimalString(-24000, "INR")).toBe("-240.00");
    expect(toDecimalString(1500, "JPY")).toBe("1500");
  });

  it("reads search queries as exact amounts", () => {
    expect(parseQueryAmount("240", "INR")).toBe(24000);
    expect(parseQueryAmount("1,240.50", "INR")).toBe(124050);
    expect(parseQueryAmount("1.234", "INR")).toBeNull();
    expect(parseQueryAmount("lunch", "INR")).toBeNull();
    expect(parseQueryAmount("1500", "JPY")).toBe(1500);
  });

  it("computes one-decimal percentages", () => {
    expect(percentOf(15000, 42380)).toBe(35.4);
    expect(percentOf(1, 0)).toBe(0);
  });
});

describe("time", () => {
  it("buckets an instant by the zone it was recorded in", () => {
    const instant = new Date("2026-10-21T20:00:00Z");
    expect(localDateOf(instant, "Asia/Kolkata")).toBe("2026-10-22");
    expect(localDateOf(instant, "America/New_York")).toBe("2026-10-21");
  });

  it("builds an instant from local wall-clock time", () => {
    expect(instantAt("2026-10-22", "13:20", "Asia/Kolkata").toISOString()).toBe(
      "2026-10-22T07:50:00.000Z",
    );
  });

  it("clamps month arithmetic to the end of short months and keeps the anchor day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-02-28", 1, 31)).toBe("2026-03-31");
  });

  it("finds weeks for Monday and Sunday starts", () => {
    expect(weekRange("2026-10-22", "mon")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekRange("2026-10-22", "sun")).toEqual({ from: "2026-10-18", to: "2026-10-24" });
  });

  it("returns the current and previous period", () => {
    expect(periodRanges("month", "2026-03-10", "mon")).toEqual({
      current: { from: "2026-03-01", to: "2026-03-31" },
      previous: { from: "2026-02-01", to: "2026-02-28" },
    });
    expect(periodRanges("year", "2026-03-10", "mon").previous).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("lists every day of a month", () => {
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2026-10").at(-1)).toBe("2026-10-31");
  });

  it("steps repeat rules without drifting off their anchor day", () => {
    const monthly = { freq: "monthly", interval: 1, anchorDay: 31, anchorMonth: 1 };
    expect(nextOccurrenceDate("2026-01-31", monthly)).toBe("2026-02-28");
    expect(nextOccurrenceDate("2026-02-28", monthly)).toBe("2026-03-31");
    expect(nextOccurrenceDate("2026-10-22", { freq: "weekly", interval: 2 })).toBe("2026-11-05");
    expect(
      nextOccurrenceDate("2028-02-29", {
        freq: "yearly",
        interval: 1,
        anchorDay: 29,
        anchorMonth: 2,
      }),
    ).toBe("2029-02-28");
  });
});

describe("balances", () => {
  const accounts = [
    { _id: "bank", type: "bank", openingBalanceMinor: 100000 },
    { _id: "debit", type: "debit_card", linkedAccountId: "bank", openingBalanceMinor: 0 },
    { _id: "card", type: "credit_card", openingBalanceMinor: 5000 },
    { _id: "cash", type: "cash", openingBalanceMinor: 2000 },
  ];
  const flows = new Map([
    ["bank", { income: 50000, expense: 10000, transferIn: 0, transferOut: 8000 }],
    ["debit", { income: 0, expense: 3000, transferIn: 0, transferOut: 0 }],
    ["card", { income: 1000, expense: 12000, transferIn: 8000, transferOut: 0 }],
  ]);

  it("rolls debit-card spending into its bank and treats cards as owed", () => {
    const balances = computeBalances(accounts, flows);
    expect(balances.get("bank")).toEqual({ balanceMinor: 100000 + 50000 - 10000 - 8000 - 3000 });
    expect(balances.get("debit")).toEqual({ balanceMinor: null });
    expect(balances.get("card")).toEqual({ owedMinor: 5000 + 12000 - 1000 - 8000 });
    expect(balances.get("cash")).toEqual({ balanceMinor: 2000 });
  });

  it("computes net worth as assets minus card debt", () => {
    const balances = computeBalances(accounts, flows);
    expect(summarize(accounts, balances)).toEqual({
      assetsMinor: 129000 + 2000,
      liabilitiesMinor: 8000,
      netWorthMinor: 131000 - 8000,
    });
  });
});
