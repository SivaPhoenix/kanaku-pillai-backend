import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { Account } from "../../src/models/account.model.js";
import { Category } from "../../src/models/category.model.js";
import { User } from "../../src/models/user.model.js";
import { setupRouter } from "../../src/routes/v1/setup.route.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser } from "../helpers/ledger.js";

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

const app = createTestApp("/me/setup", setupRouter);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

const body = {
  currencyCode: "USD",
  tzid: "America/New_York",
  startingBalances: {
    savingsMinor: 15260000,
    walletMinor: 630000,
    creditCardOwedMinor: 1245000,
    investmentsMinor: 5000000,
  },
  starterCategories: true,
};

const freshUser = () => createSignedInUser({ setupComplete: false });
const run = (headers, payload) => request(app).post("/me/setup").set(headers).send(payload);

describe("POST /me/setup", () => {
  it("creates 5 accounts, 19 categories, updates settings and completes setup", async () => {
    const { headers, userId } = await freshUser();
    const res = await run(headers, body);
    expect(res.status).toBe(201);

    const { user, accounts, categories } = res.body.data;
    expect(user.setupComplete).toBe(true);
    expect(user.settings).toMatchObject({
      currencyCode: "USD",
      locale: "en-US",
      tzid: "America/New_York",
    });
    expect(user).not.toHaveProperty("passwordHash");

    expect(accounts.map((a) => a.name)).toEqual([
      "Savings",
      "Wallet",
      "Credit card",
      "Debit card",
      "SIP & Stocks",
    ]);
    const [savings, wallet, card, debit, investments] = accounts;
    expect(savings).toMatchObject({
      type: "bank",
      isDefault: true,
      icon: "bank",
      color: "c2",
      balanceMinor: 15260000,
      openingBalanceMinor: 15260000,
    });
    expect(wallet).toMatchObject({
      type: "cash",
      icon: "wallet",
      color: "c5",
      balanceMinor: 630000,
    });
    expect(card).toMatchObject({
      type: "credit_card",
      icon: "card",
      color: "c3",
      owedMinor: 1245000,
    });
    expect(debit).toMatchObject({
      type: "debit_card",
      linkedAccountId: savings.id,
      balanceMinor: null,
      isDefault: false,
    });
    expect(investments).toMatchObject({
      type: "investment",
      icon: "trend",
      color: "c4",
      balanceMinor: 5000000,
      isDefault: false,
    });
    expect(accounts.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3, 4]);

    expect(categories).toHaveLength(19);
    const expense = categories.filter((c) => c.kind === "expense");
    const income = categories.filter((c) => c.kind === "income");
    expect(expense).toHaveLength(13);
    expect(income).toHaveLength(6);
    expect(expense.at(-1).name).toBe("Others");
    expect(income.at(-1).name).toBe("Others");
    expect(categories[0]).toMatchObject({
      name: "Food",
      kind: "expense",
      sortOrder: 0,
      usageThisMonth: 0,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/_id|__v|userId|nameKey/);

    const stored = await User.findById(userId);
    expect(stored.setupComplete).toBe(true);
    expect(stored.settings.currencyCode).toBe("USD");
    expect(await Account.countDocuments({ userId })).toBe(5);
    expect(await Category.countDocuments({ userId })).toBe(19);
  });

  it("defaults balances to zero and falls back to en-US for unknown currencies", async () => {
    const { headers } = await freshUser();
    const res = await run(headers, { currencyCode: "CHF", tzid: "Europe/Zurich" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.settings.locale).toBe("en-US");
    expect(
      res.body.data.accounts.map((a) =>
        a.balanceMinor === null ? null : (a.balanceMinor ?? a.owedMinor),
      ),
    ).toEqual([0, 0, 0, null, 0]);
    expect(res.body.data.categories).toHaveLength(19);
  });

  it("uses the mapped locale for INR", async () => {
    const { headers } = await freshUser();
    const res = await run(headers, { currencyCode: "inr", tzid: "Asia/Kolkata" });
    expect(res.body.data.user.settings).toMatchObject({ currencyCode: "INR", locale: "en-IN" });
  });

  it("skips starter categories when asked", async () => {
    const { headers, userId } = await freshUser();
    const res = await run(headers, { ...body, starterCategories: false });
    expect(res.status).toBe(201);
    expect(res.body.data.categories).toEqual([]);
    expect(await Category.countDocuments({ userId })).toBe(0);
    expect(await Account.countDocuments({ userId })).toBe(5);
  });

  it("returns 409 SETUP_ALREADY_DONE on a second call and creates nothing more", async () => {
    const { headers, userId } = await freshUser();
    expect((await run(headers, body)).status).toBe(201);
    const again = await run(headers, body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("SETUP_ALREADY_DONE");
    expect(await Account.countDocuments({ userId })).toBe(5);
    expect(await Category.countDocuments({ userId })).toBe(19);

    const done = await createSignedInUser();
    expect((await run(done.headers, body)).body.error.code).toBe("SETUP_ALREADY_DONE");
  });

  it("rejects invalid bodies", async () => {
    const { headers, userId } = await freshUser();
    for (const payload of [
      {},
      { ...body, currencyCode: "ZZZ" },
      { ...body, tzid: "Mars/Base" },
      { ...body, startingBalances: { savingsMinor: -1 } },
      { ...body, startingBalances: { savingsMinor: 1.5 } },
      { ...body, startingBalances: { bonusMinor: 1 } },
      { ...body, starterCategories: "yes" },
      { ...body, extra: true },
    ]) {
      const res = await run(headers, payload);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await User.findById(userId)).setupComplete).toBe(false);
    expect(await Account.countDocuments({ userId })).toBe(0);
  });

  it("requires auth and keeps users separate", async () => {
    expect((await request(app).post("/me/setup").send(body)).status).toBe(401);
    const a = await freshUser();
    const b = await freshUser();
    await run(a.headers, body);
    expect(await Account.countDocuments({ userId: b.userId })).toBe(0);
    expect((await User.findById(b.userId)).setupComplete).toBe(false);
  });
});
