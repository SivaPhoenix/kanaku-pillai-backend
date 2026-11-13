import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { Transaction } from "../../src/models/transaction.model.js";
import { statsRouter } from "../../src/routes/v1/stats.route.js";
import { instantAt } from "../../src/utils/time.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser, seedLedger } from "../helpers/ledger.js";

function createTestApp(path, router) {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(path, router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = createTestApp("/stats", statsRouter);
const TZ = "Asia/Kolkata";

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

function entry(userId, fields) {
  const { localDate, ...rest } = fields;
  return Transaction.create({
    userId,
    currencyCode: "INR",
    tzid: TZ,
    createdOn: "web",
    occurredAt: instantAt(localDate, "10:00", TZ),
    localDate,
    localMonth: localDate.slice(0, 7),
    ...rest,
  });
}

async function seedMonth(userId, ledger) {
  const { accounts: a, categories: c } = ledger;
  await entry(userId, {
    type: "expense",
    amountMinor: 100000,
    localDate: "2026-10-05",
    categoryId: c.food._id,
    accountId: a.savings._id,
  });
  await entry(userId, {
    type: "expense",
    amountMinor: 50000,
    localDate: "2026-10-05",
    categoryId: c.food._id,
    accountId: a.wallet._id,
  });
  await entry(userId, {
    type: "expense",
    amountMinor: 50000,
    localDate: "2026-10-06",
    categoryId: c.transport._id,
    accountId: a.savings._id,
  });
  await entry(userId, {
    type: "income",
    amountMinor: 500000,
    localDate: "2026-10-01",
    categoryId: c.salary._id,
    accountId: a.savings._id,
  });
  await entry(userId, {
    type: "transfer",
    amountMinor: 99999,
    localDate: "2026-10-07",
    accountId: a.savings._id,
    toAccountId: a.wallet._id,
  });
  await entry(userId, {
    type: "expense",
    amountMinor: 77777,
    localDate: "2026-10-08",
    categoryId: c.food._id,
    accountId: a.savings._id,
    deletedAt: new Date(),
  });
}

describe("GET /stats/month/:month", () => {
  it("totals income and expense, excluding transfers and deleted entries", async () => {
    const { userId, headers } = await createSignedInUser();
    const ledger = await seedLedger(userId);
    await seedMonth(userId, ledger);
    const { accounts: a, categories: c } = ledger;

    const res = await request(app).get("/stats/month/2026-10").set(headers);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(
      [
        "month",
        "currencyCode",
        "incomeMinor",
        "expenseMinor",
        "balanceMinor",
        "byCategory",
        "byAccount",
        "days",
      ].sort(),
    );
    expect(data).toMatchObject({
      month: "2026-10",
      currencyCode: "INR",
      incomeMinor: 500000,
      expenseMinor: 200000,
      balanceMinor: 300000,
    });
    expect(data.byCategory).toEqual([
      { categoryId: String(c.food._id), amountMinor: 150000, pct: 75 },
      { categoryId: String(c.transport._id), amountMinor: 50000, pct: 25 },
    ]);
    expect(data.byAccount).toEqual([
      { accountId: String(a.savings._id), amountMinor: 150000 },
      { accountId: String(a.wallet._id), amountMinor: 50000 },
    ]);
    expect(data.days).toHaveLength(31);
    expect(data.days[0]).toEqual({ localDate: "2026-10-01", expenseMinor: 0, incomeMinor: 500000 });
    expect(data.days[4]).toEqual({ localDate: "2026-10-05", expenseMinor: 150000, incomeMinor: 0 });
    expect(data.days[6]).toEqual({ localDate: "2026-10-07", expenseMinor: 0, incomeMinor: 0 });
    expect(JSON.stringify(data)).not.toMatch(/_id|__v|userId/);
  });

  it("returns zero-filled days for an empty month and ignores other users' data", async () => {
    const owner = await createSignedInUser();
    await seedMonth(owner.userId, await seedLedger(owner.userId));
    const other = await createSignedInUser();

    const res = await request(app).get("/stats/month/2026-02").set(other.headers);
    expect(res.body.data).toMatchObject({ expenseMinor: 0, incomeMinor: 0, byCategory: [] });
    expect(res.body.data.days).toHaveLength(28);

    const own = await request(app).get("/stats/month/2026-10").set(other.headers);
    expect(own.body.data.expenseMinor).toBe(0);
  });

  it("rejects a bad month and requires auth", async () => {
    const { headers } = await createSignedInUser();
    expect((await request(app).get("/stats/month/2026-13").set(headers)).status).toBe(400);
    expect((await request(app).get("/stats/month/2026-10")).status).toBe(401);
  });
});

describe("GET /stats/period", () => {
  async function seedWeeks(userId, ledger) {
    const { accounts: a, categories: c } = ledger;
    const base = { type: "expense", accountId: a.savings._id };
    await entry(userId, {
      ...base,
      amountMinor: 1000,
      localDate: "2026-10-12",
      categoryId: c.food._id,
    });
    await entry(userId, {
      ...base,
      amountMinor: 700,
      localDate: "2026-10-11",
      categoryId: c.transport._id,
    });
    await entry(userId, {
      ...base,
      amountMinor: 300,
      localDate: "2026-10-05",
      categoryId: c.food._id,
    });
  }

  it("compares a Monday-start week with the previous week", async () => {
    const { userId, headers } = await createSignedInUser();
    const ledger = await seedLedger(userId);
    await seedWeeks(userId, ledger);

    const res = await request(app).get("/stats/period?period=week&ref=2026-10-14").set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      period: "week",
      type: "expense",
      from: "2026-10-12",
      to: "2026-10-18",
      previousFrom: "2026-10-05",
      previousTo: "2026-10-11",
      totalMinor: 1000,
      previousTotalMinor: 1000,
      byCategory: [
        {
          categoryId: String(ledger.categories.food._id),
          amountMinor: 1000,
          pct: 100,
          previousAmountMinor: 300,
        },
        {
          categoryId: String(ledger.categories.transport._id),
          amountMinor: 0,
          pct: 0,
          previousAmountMinor: 700,
        },
      ],
    });
  });

  it("uses the user's Sunday week start", async () => {
    const { userId, headers } = await createSignedInUser({ settings: { weekStart: "sun" } });
    await seedWeeks(userId, await seedLedger(userId));

    const res = await request(app).get("/stats/period?period=week&ref=2026-10-14").set(headers);

    expect(res.body.data).toMatchObject({
      from: "2026-10-11",
      to: "2026-10-17",
      previousFrom: "2026-10-04",
      previousTo: "2026-10-10",
      totalMinor: 1700,
      previousTotalMinor: 300,
    });
  });

  it("supports month and year periods and the income type", async () => {
    const { userId, headers } = await createSignedInUser();
    const ledger = await seedLedger(userId);
    await seedMonth(userId, ledger);

    const month = await request(app)
      .get("/stats/period?period=month&ref=2026-10-20&type=income")
      .set(headers);
    expect(month.body.data).toMatchObject({
      type: "income",
      from: "2026-10-01",
      to: "2026-10-31",
      previousFrom: "2026-09-01",
      totalMinor: 500000,
    });

    const year = await request(app).get("/stats/period?period=year&ref=2026-03-01").set(headers);
    expect(year.body.data).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
      totalMinor: 200000,
    });
  });

  it("validates the query and requires auth", async () => {
    const { headers } = await createSignedInUser();
    expect((await request(app).get("/stats/period").set(headers)).status).toBe(400);
    expect((await request(app).get("/stats/period?period=day").set(headers)).status).toBe(400);
    expect((await request(app).get("/stats/period?period=week&x=1").set(headers)).status).toBe(400);
    expect(
      (await request(app).get("/stats/period?period=week&type=transfer").set(headers)).status,
    ).toBe(400);
    expect((await request(app).get("/stats/period?period=week")).status).toBe(401);
  });
});

describe("GET /stats/trend", () => {
  it("zero-fills months oldest to newest and averages", async () => {
    const { userId, headers } = await createSignedInUser();
    const { accounts: a, categories: c } = await seedLedger(userId);
    const base = { type: "expense", accountId: a.savings._id, categoryId: c.food._id };
    await entry(userId, { ...base, amountMinor: 3000, localDate: "2026-08-10" });
    await entry(userId, { ...base, amountMinor: 1000, localDate: "2026-10-10" });
    await entry(userId, {
      ...base,
      amountMinor: 9999,
      localDate: "2026-10-11",
      deletedAt: new Date(),
    });

    const res = await request(app).get("/stats/trend?end=2026-10").set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      type: "expense",
      points: [
        { month: "2026-05", amountMinor: 0 },
        { month: "2026-06", amountMinor: 0 },
        { month: "2026-07", amountMinor: 0 },
        { month: "2026-08", amountMinor: 3000 },
        { month: "2026-09", amountMinor: 0 },
        { month: "2026-10", amountMinor: 1000 },
      ],
      averageMinor: 667,
    });

    const twelve = await request(app).get("/stats/trend?months=12&end=2026-10").set(headers);
    expect(twelve.body.data.points).toHaveLength(12);
    expect(twelve.body.data.points[0].month).toBe("2025-11");
  });

  it("defaults to the current month and validates", async () => {
    const { headers } = await createSignedInUser();
    const res = await request(app).get("/stats/trend?type=income").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.points).toHaveLength(6);
    expect(res.body.data.averageMinor).toBe(0);
    expect((await request(app).get("/stats/trend?months=7").set(headers)).status).toBe(400);
    expect((await request(app).get("/stats/trend?end=2026-1").set(headers)).status).toBe(400);
    expect((await request(app).get("/stats/trend")).status).toBe(401);
  });
});
