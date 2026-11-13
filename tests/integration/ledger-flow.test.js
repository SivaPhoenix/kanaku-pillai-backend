import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { generateDueOccurrences } from "../../src/services/recurrence-generation.service.js";
import { addDays, instantAt, localDateOf, todayIn } from "../../src/utils/time.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser } from "../helpers/ledger.js";

// End-to-end through the real app (all routers mounted): setup → entries → balances → stats → search → settings.
const app = createApp();
const TZ = "Asia/Kolkata";

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

async function setUp() {
  const { headers } = await createSignedInUser({ setupComplete: false });
  const setup = await request(app)
    .post("/api/v1/me/setup")
    .set(headers)
    .send({
      currencyCode: "INR",
      tzid: TZ,
      startingBalances: { savingsMinor: 10000000, walletMinor: 500000, creditCardOwedMinor: 0 },
    });
  expect(setup.status).toBe(201);
  const byName = (list) => Object.fromEntries(list.map((item) => [item.name, item]));
  return {
    headers,
    accounts: byName(setup.body.data.accounts),
    categories: byName(setup.body.data.categories),
  };
}

const post = (headers, body) => request(app).post("/api/v1/transactions").set(headers).send(body);

describe("ledger flow through the real app", () => {
  it("keeps balances, net worth, stats and search consistent", async () => {
    const { headers, accounts, categories } = await setUp();
    // Entries sit a little before now (balances count only entries up to now); the month comes from the same instant.
    const base = Date.now() - 60 * 60 * 1000;
    const at = (minutes) => new Date(base + minutes * 60 * 1000).toISOString();

    // Salary into Savings, lunch from Wallet, groceries on the debit card, a card purchase, a bill payment.
    const created = await Promise.all([
      post(headers, {
        type: "income",
        amountMinor: 7900000,
        categoryId: categories.Salary.id,
        accountId: accounts.Savings.id,
        occurredAt: at(0),
        tzid: TZ,
        note: "Salary",
      }),
      post(headers, {
        type: "expense",
        amountMinor: 24000,
        categoryId: categories.Food.id,
        accountId: accounts.Wallet.id,
        occurredAt: at(5),
        tzid: TZ,
        note: "Lunch",
      }),
      post(headers, {
        type: "expense",
        amountMinor: 146000,
        categoryId: categories.Food.id,
        accountId: accounts["Debit card"].id,
        occurredAt: at(10),
        tzid: TZ,
        note: "Groceries",
      }),
      post(headers, {
        type: "expense",
        amountMinor: 987000,
        categoryId: categories.Gadgets.id,
        accountId: accounts["Credit card"].id,
        occurredAt: at(15),
        tzid: TZ,
        note: "Headphones",
      }),
    ]);
    for (const res of created) expect(res.status).toBe(201);
    const bill = await post(headers, {
      type: "transfer",
      amountMinor: 987000,
      accountId: accounts.Savings.id,
      toAccountId: accounts["Credit card"].id,
      occurredAt: at(20),
      tzid: TZ,
      note: "Card bill",
    });
    expect(bill.status).toBe(201);

    const list = await request(app).get("/api/v1/accounts").set(headers);
    expect(list.status).toBe(200);
    const balance = Object.fromEntries(list.body.data.map((a) => [a.name, a]));
    // Savings: 1,00,000 + 79,000 − 1,460 (debit card) − 9,870 (bill) = 1,67,670.00
    expect(balance.Savings.balanceMinor).toBe(10000000 + 7900000 - 146000 - 987000);
    expect(balance.Wallet.balanceMinor).toBe(500000 - 24000);
    expect(balance["Debit card"].balanceMinor).toBeNull();
    expect(balance["Credit card"].owedMinor).toBe(0);

    const summary = await request(app).get("/api/v1/accounts/summary").set(headers);
    expect(summary.body.data).toEqual({
      netWorthMinor: 10000000 + 7900000 - 146000 - 987000 + 500000 - 24000,
      assetsMinor: 10000000 + 7900000 - 146000 - 987000 + 500000 - 24000,
      liabilitiesMinor: 0,
    });

    const month = localDateOf(new Date(base), TZ).slice(0, 7);
    const stats = await request(app).get(`/api/v1/stats/month/${month}`).set(headers);
    expect(stats.status).toBe(200);
    // The card bill is a transfer: never income or expense.
    expect(stats.body.data.incomeMinor).toBe(7900000);
    expect(stats.body.data.expenseMinor).toBe(24000 + 146000 + 987000);
    expect(stats.body.data.balanceMinor).toBe(7900000 - (24000 + 146000 + 987000));
    expect(stats.body.data.byCategory[0]).toMatchObject({
      categoryId: categories.Gadgets.id,
      amountMinor: 987000,
    });

    const search = await request(app).get("/api/v1/transactions?q=food").set(headers);
    expect(search.body.data.map((tx) => tx.note).sort()).toEqual(["Groceries", "Lunch"]);
    const net = await request(app).get("/api/v1/transactions/summary").set(headers);
    expect(net.body.data).toEqual({
      count: 5,
      incomeMinor: 7900000,
      expenseMinor: 1157000,
      netMinor: 7900000 - 1157000,
    });

    // Currency change relabels every entry and never converts amounts.
    const settings = await request(app)
      .patch("/api/v1/me/settings")
      .set(headers)
      .send({ currencyCode: "USD" });
    expect(settings.body.data.relabeledCount).toBe(5);
    const after = await request(app).get("/api/v1/transactions").set(headers);
    expect(after.body.data.every((tx) => tx.currencyCode === "USD")).toBe(true);
    expect(after.body.data.find((tx) => tx.note === "Lunch").amountMinor).toBe(24000);
  });

  it("generates repeat entries server-side exactly once", async () => {
    const { headers, accounts, categories } = await setUp();
    const start = addDays(todayIn(TZ), -2);
    const res = await post(headers, {
      type: "expense",
      amountMinor: 12000,
      categoryId: categories.Transport.id,
      accountId: accounts.Wallet.id,
      occurredAt: instantAt(start, "09:05", TZ).toISOString(),
      tzid: TZ,
      note: "Auto to office",
      repeat: { freq: "daily", interval: 1 },
    });
    expect(res.status).toBe(201);

    await generateDueOccurrences();
    await generateDueOccurrences();

    const entries = await request(app).get("/api/v1/transactions?q=Auto").set(headers);
    expect(entries.body.data.map((tx) => tx.localDate).sort()).toEqual([
      start,
      addDays(start, 1),
      addDays(start, 2),
    ]);
    const rules = await request(app).get("/api/v1/recurrences").set(headers);
    expect(rules.body.data[0].nextOccurrence).toBe(addDays(start, 3));
  });

  it("counts only instalments that are already due in balances and net worth", async () => {
    const { headers, accounts, categories } = await setUp();
    const res = await post(headers, {
      type: "expense",
      amountMinor: 3600000,
      categoryId: categories.Gadgets.id,
      accountId: accounts["Credit card"].id,
      occurredAt: new Date(Date.now() - 60 * 1000).toISOString(),
      tzid: TZ,
      note: "Laptop",
      instalments: { months: 6 },
    });
    expect(res.status).toBe(201);
    const list = await request(app).get("/api/v1/accounts").set(headers);
    const card = list.body.data.find((a) => a.name === "Credit card");
    expect(card.owedMinor).toBe(600000);
    const summary = await request(app).get("/api/v1/accounts/summary").set(headers);
    expect(summary.body.data.liabilitiesMinor).toBe(600000);
  });

  it("deletes the whole account and everything in it", async () => {
    const { headers, accounts, categories } = await setUp();
    await post(headers, {
      type: "expense",
      amountMinor: 1000,
      categoryId: categories.Food.id,
      accountId: accounts.Wallet.id,
      occurredAt: new Date().toISOString(),
      tzid: TZ,
    });
    const del = await request(app).delete("/api/v1/me").set(headers).send({ confirm: "DELETE" });
    expect(del.status).toBe(204);
    const me = await request(app).get("/api/v1/me").set(headers);
    expect(me.status).toBe(401);
  });
});
