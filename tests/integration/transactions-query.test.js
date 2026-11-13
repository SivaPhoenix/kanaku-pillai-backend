import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { transactionRouter } from "../../src/routes/v1/transaction.route.js";
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

const app = createTestApp("/api/v1/transactions", transactionRouter);
const BASE = "/api/v1/transactions";

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

async function setup() {
  const me = await createSignedInUser();
  const ledger = await seedLedger(me.userId);
  return { ...me, ...ledger };
}

const add = (ctx, body) =>
  request(app)
    .post(BASE)
    .set(ctx.headers)
    .send({ tzid: "UTC", occurredAt: "2026-10-01T10:00:00.000Z", ...body });

const expense = (ctx, extra = {}) => ({
  type: "expense",
  amountMinor: 10000,
  categoryId: String(ctx.categories.food._id),
  accountId: String(ctx.accounts.savings._id),
  ...extra,
});

const get = (ctx, path = "", query = {}) =>
  request(app).get(`${BASE}${path}`).set(ctx.headers).query(query);

// Seven entries on 1..7 Oct 2026 plus a transfer and an income.
async function seedEntries(ctx) {
  for (let day = 1; day <= 7; day += 1) {
    await add(ctx, expense(ctx, { occurredAt: `2026-10-0${day}T10:00:00.000Z` }));
  }
}

describe("GET /transactions (paging and filters)", () => {
  it("pages newest first without gaps or duplicates", async () => {
    const ctx = await setup();
    await seedEntries(ctx);
    const ids = [];
    let cursor;
    let pages = 0;
    do {
      const res = await get(ctx, "", { limit: 3, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      expect(res.body.page.limit).toBe(3);
      ids.push(...res.body.data.map((tx) => tx.id));
      cursor = res.body.page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(7);
    const all = await get(ctx, "", { limit: 100 });
    expect(ids).toEqual(all.body.data.map((tx) => tx.id));
    expect(all.body.data[0].localDate).toBe("2026-10-07");
    expect(all.body.data[0]).not.toHaveProperty("_id");
    expect(all.body.data[0]).not.toHaveProperty("userId");
  });

  it("validates the query", async () => {
    const ctx = await setup();
    for (const query of [
      { limit: 101 },
      { from: "2026-10-05", to: "2026-10-01" },
      { min: 10, max: 5 },
      { type: "gift" },
      { bogus: 1 },
      { from: "nope" },
    ]) {
      expect((await get(ctx, "", query)).status).toBe(400);
    }
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it("filters by date range, type, category, amount and either account side", async () => {
    const ctx = await setup();
    await add(ctx, expense(ctx, { occurredAt: "2026-10-01T10:00:00.000Z", amountMinor: 100 }));
    await add(
      ctx,
      expense(ctx, {
        occurredAt: "2026-10-02T10:00:00.000Z",
        amountMinor: 500,
        categoryId: String(ctx.categories.transport._id),
      }),
    );
    await add(ctx, {
      type: "income",
      amountMinor: 9000,
      categoryId: String(ctx.categories.salary._id),
      accountId: String(ctx.accounts.savings._id),
      occurredAt: "2026-10-03T10:00:00.000Z",
    });
    await add(ctx, {
      type: "transfer",
      amountMinor: 700,
      accountId: String(ctx.accounts.savings._id),
      toAccountId: String(ctx.accounts.wallet._id),
      occurredAt: "2026-10-04T10:00:00.000Z",
    });

    const count = async (query) => (await get(ctx, "", query)).body.data.length;
    expect(await count({ from: "2026-10-02", to: "2026-10-03" })).toBe(2);
    expect(await count({ type: "expense" })).toBe(2);
    expect(await count({ categoryId: String(ctx.categories.transport._id) })).toBe(1);
    expect(await count({ min: 500, max: 700 })).toBe(2);
    expect(await count({ accountId: String(ctx.accounts.wallet._id) })).toBe(1);
    expect(await count({ accountId: String(ctx.accounts.savings._id) })).toBe(4);
    expect(await count({ accountId: String(ctx.accounts.stocks._id) })).toBe(0);
  });

  it("searches note, category name, account name and exact amount", async () => {
    const ctx = await setup();
    await add(ctx, expense(ctx, { note: "Biryani dinner", amountMinor: 11100 }));
    await add(
      ctx,
      expense(ctx, {
        categoryId: String(ctx.categories.transport._id),
        accountId: String(ctx.accounts.wallet._id),
        amountMinor: 24000,
      }),
    );
    const found = async (q) => (await get(ctx, "", { q })).body.data;
    expect(await found("BIRYANI")).toHaveLength(1);
    expect(await found("transp")).toHaveLength(1);
    expect(await found("wallet")).toHaveLength(1);
    expect((await found("240"))[0].amountMinor).toBe(24000);
    expect(await found("zzz")).toHaveLength(0);
    for (const q of ["(", "[", ".*", "\\", "a|b"]) {
      expect((await get(ctx, "", { q })).status).toBe(200);
    }
    expect(await found(".*")).toHaveLength(0);
  });

  it("isolates users", async () => {
    const ctx = await setup();
    const other = await setup();
    await add(ctx, expense(ctx));
    expect((await get(other)).body.data).toHaveLength(0);
    expect((await get(other, "/summary")).body.data.count).toBe(0);
  });
});

describe("GET /transactions/summary and /day", () => {
  it("excludes transfers from net but counts them, and skips deleted entries", async () => {
    const ctx = await setup();
    await add(ctx, expense(ctx, { amountMinor: 3000 }));
    const doomed = await add(ctx, expense(ctx, { amountMinor: 99999 }));
    await add(ctx, {
      type: "income",
      amountMinor: 10000,
      categoryId: String(ctx.categories.salary._id),
      accountId: String(ctx.accounts.savings._id),
    });
    await add(ctx, {
      type: "transfer",
      amountMinor: 5000,
      accountId: String(ctx.accounts.savings._id),
      toAccountId: String(ctx.accounts.wallet._id),
    });
    await request(app).delete(`${BASE}/${doomed.body.data.id}`).set(ctx.headers);

    const res = await get(ctx, "/summary");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      count: 3,
      incomeMinor: 10000,
      expenseMinor: 3000,
      netMinor: 7000,
    });
    expect((await get(ctx, "/summary", { type: "income" })).body.data.netMinor).toBe(10000);
    expect((await get(ctx, "/summary", { limit: 5 })).status).toBe(400);
    expect((await request(app).get(`${BASE}/summary`)).status).toBe(401);
  });

  it("returns the day with totals", async () => {
    const ctx = await setup();
    await add(ctx, expense(ctx, { amountMinor: 3000 }));
    await add(ctx, {
      type: "income",
      amountMinor: 10000,
      categoryId: String(ctx.categories.salary._id),
      accountId: String(ctx.accounts.savings._id),
      occurredAt: "2026-10-01T12:00:00.000Z",
    });
    await add(ctx, expense(ctx, { occurredAt: "2026-10-02T10:00:00.000Z" }));
    const res = await get(ctx, "/day/2026-10-01");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      localDate: "2026-10-01",
      inMinor: 10000,
      outMinor: 3000,
      count: 2,
    });
    expect(res.body.data.items.map((tx) => tx.type)).toEqual(["income", "expense"]);
    expect((await get(ctx, "/day/2026-13-45")).status).toBe(400);
    const other = await setup();
    expect((await get(other, "/day/2026-10-01")).body.data.count).toBe(0);
    expect((await request(app).get(`${BASE}/day/2026-10-01`)).status).toBe(401);
  });
});

describe("GET /transactions/export.csv", () => {
  it("exports rows with names and neutralises formulas", async () => {
    const ctx = await setup();
    await add(ctx, expense(ctx, { note: "=SUM(A1)", amountMinor: 24050 }));
    await add(ctx, expense(ctx, { note: 'say "hi", ok', occurredAt: "2026-10-02T09:30:00.000Z" }));
    await add(ctx, {
      type: "transfer",
      amountMinor: 500,
      accountId: String(ctx.accounts.savings._id),
      toAccountId: String(ctx.accounts.wallet._id),
      occurredAt: "2026-10-03T09:30:00.000Z",
    });

    const res = await get(ctx, "/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="kanaku-pillai-transactions.csv"',
    );
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Time,Type,Amount,Currency,Category,Account,To account,Note");
    expect(lines[1]).toBe("2026-10-03,09:30,transfer,5.00,INR,,Savings,Wallet,");
    expect(lines[2]).toBe('2026-10-02,09:30,expense,100.00,INR,Food,Savings,,"say ""hi"", ok"');
    expect(lines[3]).toBe("2026-10-01,10:00,expense,240.50,INR,Food,Savings,,'=SUM(A1)");

    const filtered = await get(ctx, "/export.csv", { type: "transfer" });
    expect(filtered.text.trim().split("\r\n")).toHaveLength(2);
    expect((await get(ctx, "/export.csv", { limit: 3 })).status).toBe(400);
    const other = await setup();
    expect((await get(other, "/export.csv")).text.trim().split("\r\n")).toHaveLength(1);
    expect((await request(app).get(`${BASE}/export.csv`)).status).toBe(401);
  });
});

describe("seed helper", () => {
  it("seeds entries", async () => {
    const ctx = await setup();
    await seedEntries(ctx);
    expect((await get(ctx, "/summary")).body.data.count).toBe(7);
  });
});
