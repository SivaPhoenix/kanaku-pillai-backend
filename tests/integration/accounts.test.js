import cookieParser from "cookie-parser";
import express from "express";
import { DateTime } from "luxon";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { Account } from "../../src/models/account.model.js";
import { Favourite } from "../../src/models/favourite.model.js";
import { RecurrenceRule } from "../../src/models/recurrence-rule.model.js";
import { Transaction } from "../../src/models/transaction.model.js";
import { accountRouter } from "../../src/routes/v1/account.route.js";
import { localDateOf, localMonthOf, todayIn } from "../../src/utils/time.js";
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

const app = createTestApp("/accounts", accountRouter);
const TZ = "Asia/Kolkata";

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

function addTx(userId, fields) {
  const occurredAt = fields.occurredAt ?? new Date();
  return Transaction.create({
    userId,
    currencyCode: "INR",
    tzid: TZ,
    createdOn: "web",
    occurredAt,
    localDate: localDateOf(occurredAt, TZ),
    localMonth: localMonthOf(occurredAt, TZ),
    ...fields,
  });
}

const get = (headers, path) => request(app).get(path).set(headers);
const post = (headers, path, body) => request(app).post(path).set(headers).send(body);
const byName = (list, name) => list.find((account) => account.name === name);

async function seeded(opening) {
  const { headers, userId } = await createSignedInUser();
  const ledger = await seedLedger(userId, { opening });
  return { headers, userId, ...ledger };
}

describe("GET /accounts balances", () => {
  it("computes bank, debit roll-up, credit card owed and ignores deleted entries", async () => {
    const { headers, userId, accounts, categories } = await seeded({
      savings: 100000,
      wallet: 5000,
      card: 20000,
    });
    const base = { userId };
    await addTx(base.userId, {
      type: "income",
      amountMinor: 50000,
      accountId: accounts.savings._id,
      categoryId: categories.salary._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 3000,
      accountId: accounts.savings._id,
      categoryId: categories.food._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 1200,
      accountId: accounts.debit._id,
      categoryId: categories.food._id,
    });
    await addTx(userId, {
      type: "transfer",
      amountMinor: 10000,
      accountId: accounts.savings._id,
      toAccountId: accounts.wallet._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 8000,
      accountId: accounts.card._id,
      categoryId: categories.food._id,
    });
    await addTx(userId, {
      type: "income",
      amountMinor: 500,
      accountId: accounts.card._id,
      categoryId: categories.salary._id,
    });
    await addTx(userId, {
      type: "transfer",
      amountMinor: 4000,
      accountId: accounts.savings._id,
      toAccountId: accounts.card._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 99999,
      accountId: accounts.savings._id,
      categoryId: categories.food._id,
      deletedAt: new Date(),
    });

    const res = await get(headers, "/accounts");
    expect(res.status).toBe(200);
    const list = res.body.data;
    // 100000 + 50000 - 3000 - 1200 (debit) - 10000 - 4000
    expect(byName(list, "Savings").balanceMinor).toBe(131800);
    expect(byName(list, "Wallet").balanceMinor).toBe(15000);
    expect(byName(list, "Debit card").balanceMinor).toBeNull();
    const card = byName(list, "Credit card");
    // 20000 + 8000 - 500 - 4000
    expect(card.owedMinor).toBe(23500);
    expect(card.limitUsedPct).toBe(0.2);
    expect(card.balanceMinor).toBeUndefined();
    expect(JSON.stringify(list)).not.toMatch(/_id|__v|userId|nameKey/);
    expect(list.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3, 4]);

    const summary = await get(headers, "/accounts/summary");
    expect(summary.body.data).toEqual({
      netWorthMinor: 131800 + 15000 + 0 - 23500,
      assetsMinor: 131800 + 15000,
      liabilitiesMinor: 23500,
    });
  });

  it("reports statement fields for a credit card", async () => {
    const { headers, userId, accounts, categories } = await seeded({ card: 500 });
    const statementDay = 20;
    const dueDay = 5;
    await Account.updateOne(
      { _id: accounts.card._id },
      { $set: { statementDay, dueDay, creditLimitMinor: 10000 } },
    );
    const today = DateTime.fromISO(todayIn(TZ), { zone: "utc" });
    const last =
      today.day >= statementDay
        ? today.set({ day: statementDay })
        : today.minus({ months: 1 }).set({ day: statementDay });
    const due =
      last.set({ day: dueDay }) > last
        ? last.set({ day: dueDay })
        : last.plus({ months: 1 }).set({ day: dueDay });
    const at = (date, hour) =>
      DateTime.fromISO(`${date.toISODate()}T${hour}`, { zone: TZ }).toJSDate();

    await addTx(userId, {
      type: "expense",
      amountMinor: 1000,
      accountId: accounts.card._id,
      categoryId: categories.food._id,
      occurredAt: at(last, "23:30"),
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 700,
      accountId: accounts.card._id,
      categoryId: categories.food._id,
      occurredAt: at(last.plus({ days: 1 }), "00:30"),
    });

    const res = await get(headers, `/accounts/${accounts.card._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      owedMinor: 2200,
      limitUsedPct: 22,
      statementMinor: 1500,
      lastStatementDate: last.toISODate(),
      dueDate: due.toISODate(),
    });
  });

  it("returns null statement fields without statement or due days", async () => {
    const { headers, accounts } = await seeded();
    await Account.updateOne(
      { _id: accounts.card._id },
      { $unset: { statementDay: 1, dueDay: 1, creditLimitMinor: 1 } },
    );
    const res = await get(headers, `/accounts/${accounts.card._id}`);
    expect(res.body.data).toMatchObject({
      limitUsedPct: null,
      statementMinor: null,
      lastStatementDate: null,
      dueDate: null,
    });
  });

  it("filters archived accounts unless asked", async () => {
    const { headers, accounts } = await seeded();
    await post(headers, `/accounts/${accounts.stocks._id}/archive`);
    expect((await get(headers, "/accounts")).body.data).toHaveLength(4);
    const all = await get(headers, "/accounts?includeArchived=true");
    expect(all.body.data).toHaveLength(5);
    expect((await get(headers, "/accounts?includeArchived=maybe")).status).toBe(400);
  });
});

describe("GET /accounts/:id activity", () => {
  it("sums in/out for the month and rolls debit cards into the bank", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    await addTx(userId, {
      type: "income",
      amountMinor: 9000,
      accountId: accounts.savings._id,
      categoryId: categories.salary._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 1000,
      accountId: accounts.savings._id,
      categoryId: categories.food._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 200,
      accountId: accounts.debit._id,
      categoryId: categories.food._id,
    });
    await addTx(userId, {
      type: "transfer",
      amountMinor: 3000,
      accountId: accounts.wallet._id,
      toAccountId: accounts.savings._id,
    });
    await addTx(userId, {
      type: "transfer",
      amountMinor: 400,
      accountId: accounts.savings._id,
      toAccountId: accounts.wallet._id,
    });
    await addTx(userId, {
      type: "expense",
      amountMinor: 5,
      accountId: accounts.savings._id,
      categoryId: categories.food._id,
      deletedAt: new Date(),
    });

    const res = await get(headers, `/accounts/${accounts.savings._id}`);
    expect(res.status).toBe(200);
    const { activity } = res.body.data;
    expect(activity.month).toBe(localMonthOf(new Date(), TZ));
    expect(activity.inMinor).toBe(12000);
    expect(activity.outMinor).toBe(1600);
    expect(activity.recent).toHaveLength(5);
    expect(activity.recent[0]).toHaveProperty("localDate");
    expect(JSON.stringify(activity.recent)).not.toMatch(/_id|userId/);

    const debit = await get(headers, `/accounts/${accounts.debit._id}`);
    expect(debit.body.data.activity.outMinor).toBe(200);
    expect(debit.body.data.activity.inMinor).toBe(0);

    const empty = await get(headers, `/accounts/${accounts.savings._id}?month=2020-01`);
    expect(empty.body.data.activity).toEqual({
      month: "2020-01",
      inMinor: 0,
      outMinor: 0,
      recent: [],
    });
    expect((await get(headers, `/accounts/${accounts.savings._id}?month=bad`)).status).toBe(400);
  });

  it("returns 404 for another user's account and 400 for a bad id", async () => {
    const mine = await seeded();
    const other = await createSignedInUser();
    expect((await get(other.headers, `/accounts/${mine.accounts.savings._id}`)).status).toBe(404);
    expect((await get(mine.headers, "/accounts/nope")).status).toBe(400);
  });
});

describe("POST /accounts", () => {
  const valid = { name: "  Savings  ", type: "bank", icon: "bank", color: "c2" };

  it("creates the first account as default and later ones after it", async () => {
    const { headers } = await createSignedInUser();
    const first = await post(headers, "/accounts", {
      ...valid,
      last4: "4821",
      openingBalanceMinor: -50,
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      name: "Savings",
      last4: "4821",
      openingBalanceMinor: -50,
      balanceMinor: -50,
      isDefault: true,
      sortOrder: 0,
      archived: false,
      linkedAccountId: null,
      creditLimitMinor: null,
    });
    const second = await post(headers, "/accounts", {
      name: "Wallet",
      type: "cash",
      icon: "wallet",
      color: "c5",
    });
    expect(second.body.data).toMatchObject({ isDefault: false, sortOrder: 1, balanceMinor: 0 });
  });

  it("rejects bad input and unknown fields", async () => {
    const { headers } = await createSignedInUser();
    for (const body of [
      { ...valid, name: "" },
      { ...valid, name: "x".repeat(41) },
      { ...valid, last4: "12" },
      { ...valid, type: "gold" },
      { ...valid, icon: "😀" },
      { ...valid, color: "c9" },
      { ...valid, openingBalanceMinor: 1.5 },
      { ...valid, extra: true },
      { ...valid, statementDay: 29, type: "credit_card" },
    ]) {
      const res = await post(headers, "/accounts", body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("requires auth", async () => {
    expect((await request(app).post("/accounts").send(valid)).status).toBe(401);
    expect((await request(app).get("/accounts")).status).toBe(401);
    expect((await request(app).get("/accounts/summary")).status).toBe(401);
  });

  it("keeps names unique case-insensitively among non-archived accounts", async () => {
    const { headers } = await createSignedInUser();
    const created = await post(headers, "/accounts", valid);
    const clash = await post(headers, "/accounts", { ...valid, name: "SAVINGS" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("NAME_TAKEN");

    await post(headers, `/accounts/${created.body.data.id}/archive`);
    expect((await post(headers, "/accounts", valid)).status).toBe(201);

    const unarchive = await post(headers, `/accounts/${created.body.data.id}/unarchive`);
    expect(unarchive.status).toBe(409);
    expect(unarchive.body.error.code).toBe("NAME_TAKEN");
  });

  it("validates debit card links", async () => {
    const { headers, accounts } = await seeded();
    const debit = { name: "Second debit", type: "debit_card", icon: "card", color: "c2" };

    const missing = await post(headers, "/accounts", debit);
    expect(missing.status).toBe(400);

    const notBank = await post(headers, "/accounts", {
      ...debit,
      linkedAccountId: String(accounts.wallet._id),
    });
    expect(notBank.status).toBe(400);
    expect(notBank.body.error.code).toBe("VALIDATION_ERROR");

    const ghost = await post(headers, "/accounts", {
      ...debit,
      linkedAccountId: String(new mongoose.Types.ObjectId()),
    });
    expect(ghost.status).toBe(404);

    const other = await seeded();
    const foreign = await post(headers, "/accounts", {
      ...debit,
      linkedAccountId: String(other.accounts.savings._id),
    });
    expect(foreign.status).toBe(404);

    const withOpening = await post(headers, "/accounts", {
      ...debit,
      linkedAccountId: String(accounts.savings._id),
      openingBalanceMinor: 5,
    });
    expect(withOpening.status).toBe(400);

    const good = await post(headers, "/accounts", {
      ...debit,
      linkedAccountId: String(accounts.savings._id),
    });
    expect(good.status).toBe(201);
    expect(good.body.data).toMatchObject({
      linkedAccountId: String(accounts.savings._id),
      balanceMinor: null,
    });

    const linkOnBank = await post(headers, "/accounts", {
      name: "Odd",
      type: "cash",
      icon: "cash",
      color: "c1",
      linkedAccountId: String(accounts.savings._id),
    });
    expect(linkOnBank.status).toBe(400);
  });

  it("rejects credit-only fields on other types and negative card balances", async () => {
    const { headers } = await createSignedInUser();
    for (const extra of [{ creditLimitMinor: 100 }, { statementDay: 3 }, { dueDay: 4 }]) {
      const res = await post(headers, "/accounts", {
        name: "Bank",
        type: "bank",
        icon: "bank",
        color: "c1",
        ...extra,
      });
      expect(res.status).toBe(400);
    }
    const negative = await post(headers, "/accounts", {
      name: "Card",
      type: "credit_card",
      icon: "card",
      color: "c1",
      openingBalanceMinor: -1,
    });
    expect(negative.status).toBe(400);
    const card = await post(headers, "/accounts", {
      name: "Card",
      type: "credit_card",
      icon: "card",
      color: "c1",
      openingBalanceMinor: 1000,
      creditLimitMinor: 5000,
      statementDay: 10,
      dueDay: 28,
    });
    expect(card.status).toBe(201);
    expect(card.body.data).toMatchObject({
      owedMinor: 1000,
      limitUsedPct: 20,
      creditLimitMinor: 5000,
    });
  });
});

describe("PATCH /accounts/:id", () => {
  it("updates fields, clears optional ones with null and rejects bad input", async () => {
    const { headers, accounts } = await seeded();
    const id = accounts.card._id;
    const res = await request(app)
      .patch(`/accounts/${id}`)
      .set(headers)
      .send({ name: "Visa", last4: "1234", creditLimitMinor: null, dueDay: 9 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Visa",
      last4: "1234",
      creditLimitMinor: null,
      dueDay: 9,
      limitUsedPct: null,
    });
    const bad = [{}, { extra: 1 }, { statementDay: 0 }];
    for (const body of bad) {
      expect((await request(app).patch(`/accounts/${id}`).set(headers).send(body)).status).toBe(
        400,
      );
    }
    const onBank = await request(app)
      .patch(`/accounts/${accounts.savings._id}`)
      .set(headers)
      .send({ statementDay: 3 });
    expect(onBank.status).toBe(400);
    const taken = await request(app).patch(`/accounts/${id}`).set(headers).send({ name: "WALLET" });
    expect(taken.body.error.code).toBe("NAME_TAKEN");
  });

  it("locks the type once entries exist and 404s for other users", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    const free = await request(app)
      .patch(`/accounts/${accounts.stocks._id}`)
      .set(headers)
      .send({ type: "bank" });
    expect(free.status).toBe(200);
    expect(free.body.data.type).toBe("bank");

    await addTx(userId, {
      type: "expense",
      amountMinor: 1,
      accountId: accounts.wallet._id,
      categoryId: categories.food._id,
      deletedAt: new Date(),
    });
    const locked = await request(app)
      .patch(`/accounts/${accounts.wallet._id}`)
      .set(headers)
      .send({ type: "investment" });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("TYPE_LOCKED");

    const stranger = await createSignedInUser();
    const res = await request(app)
      .patch(`/accounts/${accounts.wallet._id}`)
      .set(stranger.headers)
      .send({ name: "Mine now" });
    expect(res.status).toBe(404);
    expect((await Account.findById(accounts.wallet._id)).name).toBe("Wallet");
  });
});

describe("archive, unarchive and default", () => {
  it("archiving the default clears it; making another default moves the flag", async () => {
    const { headers, accounts } = await seeded();
    const archived = await post(headers, `/accounts/${accounts.savings._id}/archive`);
    expect(archived.body.data).toMatchObject({ archived: true, isDefault: false });
    // a bank with debit cards can be archived
    const denied = await post(headers, `/accounts/${accounts.savings._id}/default`);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe("ACCOUNT_ARCHIVED");

    const unarchived = await post(headers, `/accounts/${accounts.savings._id}/unarchive`);
    expect(unarchived.body.data.archived).toBe(false);

    await post(headers, `/accounts/${accounts.wallet._id}/default`);
    const list = (await get(headers, "/accounts")).body.data;
    expect(list.filter((a) => a.isDefault).map((a) => a.name)).toEqual(["Wallet"]);
  });

  it("404s for another user's account", async () => {
    const mine = await seeded();
    const other = await createSignedInUser();
    for (const action of ["archive", "unarchive", "default"]) {
      const res = await post(other.headers, `/accounts/${mine.accounts.wallet._id}/${action}`);
      expect(res.status).toBe(404);
    }
    expect((await Account.findById(mine.accounts.wallet._id)).archivedAt).toBeUndefined();
  });
});

describe("DELETE /accounts/:id", () => {
  it("deletes an unused account", async () => {
    const { headers, accounts } = await seeded();
    const res = await request(app).delete(`/accounts/${accounts.stocks._id}`).set(headers);
    expect(res.status).toBe(204);
    expect(await Account.findById(accounts.stocks._id)).toBeNull();
  });

  it("blocks with IN_USE for entries (even deleted), transfers, favourites, rules and debit cards", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    const inUse = async (id) => {
      const res = await request(app).delete(`/accounts/${id}`).set(headers);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("IN_USE");
    };
    await addTx(userId, {
      type: "expense",
      amountMinor: 1,
      accountId: accounts.wallet._id,
      categoryId: categories.food._id,
      deletedAt: new Date(),
    });
    await inUse(accounts.wallet._id);

    await addTx(userId, {
      type: "transfer",
      amountMinor: 1,
      accountId: accounts.wallet._id,
      toAccountId: accounts.stocks._id,
    });
    await inUse(accounts.stocks._id);

    await inUse(accounts.savings._id);

    await Favourite.create({
      userId,
      title: "Lunch",
      icon: "food",
      type: "expense",
      amountMinor: 100,
      categoryId: categories.food._id,
      accountId: accounts.card._id,
    });
    await inUse(accounts.card._id);

    const fresh = await post(headers, "/accounts", {
      name: "Piggy",
      type: "cash",
      icon: "cash",
      color: "c1",
    });
    await RecurrenceRule.create({
      userId,
      template: {
        type: "expense",
        amountMinor: 5,
        categoryId: categories.food._id,
        accountId: fresh.body.data.id,
      },
      tzid: TZ,
      localTime: "09:00",
      freq: "monthly",
      interval: 1,
      anchorDay: 1,
      anchorMonth: 1,
      startsOn: "2030-01-01",
      nextOccurrenceDate: "2030-01-01",
    });
    await inUse(fresh.body.data.id);
  });

  it("404s for another user's account and leaves it", async () => {
    const mine = await seeded();
    const other = await createSignedInUser();
    const res = await request(app)
      .delete(`/accounts/${mine.accounts.stocks._id}`)
      .set(other.headers);
    expect(res.status).toBe(404);
    expect(await Account.findById(mine.accounts.stocks._id)).not.toBeNull();
    expect((await request(app).delete(`/accounts/${mine.accounts.stocks._id}`)).status).toBe(401);
  });
});

describe("PUT /accounts/order", () => {
  it("applies the order and returns the full list", async () => {
    const { headers, accounts } = await seeded();
    const ids = [accounts.stocks._id, accounts.wallet._id].map(String);
    const res = await request(app).put("/accounts/order").set(headers).send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.name).slice(0, 2)).toEqual(["Stocks", "Wallet"]);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("rejects foreign ids with 404, bad bodies with 400 and no token with 401", async () => {
    const mine = await seeded();
    const other = await seeded();
    const foreign = await request(app)
      .put("/accounts/order")
      .set(mine.headers)
      .send({ ids: [String(mine.accounts.wallet._id), String(other.accounts.wallet._id)] });
    expect(foreign.status).toBe(404);
    expect((await Account.findById(mine.accounts.wallet._id)).sortOrder).toBe(1);

    expect(
      (await request(app).put("/accounts/order").set(mine.headers).send({ ids: [] })).status,
    ).toBe(400);
    expect((await request(app).put("/accounts/order").send({ ids: [] })).status).toBe(401);
  });
});

describe("name uniqueness and limits", () => {
  const body = (name) => ({ name, type: "cash", icon: "cash", color: "c1" });

  it("lets the database pick one winner when the same name is created concurrently", async () => {
    const { headers } = await createSignedInUser();
    await Account.init();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(headers, "/accounts", body("Piggy"))),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    for (const res of results.filter((r) => r.status !== 201)) {
      expect([res.status, res.body.error.code]).toEqual([409, "NAME_TAKEN"]);
    }
  });

  it("rejects unarchiving into a name that is now taken", async () => {
    const { headers } = await createSignedInUser();
    const first = await post(headers, "/accounts", body("Piggy"));
    await post(headers, `/accounts/${first.body.data.id}/archive`);
    await post(headers, "/accounts", body("piggy"));

    const res = await post(headers, `/accounts/${first.body.data.id}/unarchive`);

    expect([res.status, res.body.error.code]).toEqual([409, "NAME_TAKEN"]);
  });

  it("rejects creating past 50 active accounts with LIMIT_REACHED", async () => {
    const { headers, userId } = await createSignedInUser();
    await Account.insertMany(
      Array.from({ length: 50 }, (_, index) => ({
        userId,
        name: `Acc ${index}`,
        nameKey: `acc ${index}`,
        activeNameKey: `acc ${index}`,
        type: "cash",
        icon: "cash",
        color: "c1",
        sortOrder: index,
      })),
    );

    const res = await post(headers, "/accounts", body("One more"));

    expect([res.status, res.body.error.code]).toEqual([409, "LIMIT_REACHED"]);
  });
});

describe("statement balance", () => {
  it("cuts off by the entries' local date and shares one aggregation per statement date", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    const second = await Account.create({
      userId,
      name: "Second card",
      nameKey: "second card",
      activeNameKey: "second card",
      type: "credit_card",
      icon: "card",
      color: "c3",
      statementDay: 20,
      sortOrder: 9,
    });
    const spy = vi.spyOn(Transaction, "aggregate");
    const res = await get(headers, "/accounts");
    expect(res.status).toBe(200);
    // One aggregation for all balances plus one for the shared statement date.
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(res.body.data.find((a) => a.id === String(second._id)).statementMinor).toBe(0);

    const statementDate = res.body.data.find(
      (a) => a.id === String(accounts.card._id),
    ).lastStatementDate;
    const base = {
      type: "expense",
      amountMinor: 500,
      categoryId: categories.food._id,
      accountId: accounts.card._id,
    };
    // The instant is after the statement day in UTC, but the local date is on it.
    await addTx(userId, {
      ...base,
      occurredAt: new Date(`${statementDate}T20:00:00Z`),
      tzid: "America/Los_Angeles",
      localDate: statementDate,
      localMonth: statementDate.slice(0, 7),
    });
    const next = DateTime.fromISO(statementDate, { zone: "utc" }).plus({ days: 1 }).toISODate();
    await addTx(userId, {
      ...base,
      occurredAt: new Date(`${statementDate}T01:00:00Z`),
      localDate: next,
      localMonth: next.slice(0, 7),
    });

    const after = await get(headers, `/accounts/${accounts.card._id}`);

    expect(after.body.data.statementMinor).toBe(500);
    expect(after.body.data.owedMinor).toBe(1000);
  });
});
