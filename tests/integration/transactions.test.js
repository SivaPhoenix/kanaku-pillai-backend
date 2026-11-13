import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Account } from "../../src/models/account.model.js";
import { Category } from "../../src/models/category.model.js";
import { IdempotencyKey } from "../../src/models/idempotency-key.model.js";
import { InstallmentPlan } from "../../src/models/installment-plan.model.js";
import * as idempotencyRepository from "../../src/repositories/idempotency.repository.js";
import * as exportService from "../../src/services/transaction-export.service.js";
import { RecurrenceRule } from "../../src/models/recurrence-rule.model.js";
import { Transaction } from "../../src/models/transaction.model.js";
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

const expenseBody = (ctx, extra = {}) => ({
  type: "expense",
  amountMinor: 24000,
  categoryId: String(ctx.categories.food._id),
  accountId: String(ctx.accounts.savings._id),
  occurredAt: "2026-10-22T07:50:00.000Z",
  tzid: "Asia/Kolkata",
  note: "Lunch",
  ...extra,
});

const post = (ctx, body, headers = {}) =>
  request(app)
    .post(BASE)
    .set({ ...ctx.headers, ...headers })
    .send(body);

describe("POST /transactions", () => {
  it("creates an expense with the documented shape", async () => {
    const ctx = await setup();
    const res = await post(ctx, expenseBody(ctx));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      type: "expense",
      amountMinor: 24000,
      currencyCode: "INR",
      categoryId: String(ctx.categories.food._id),
      accountId: String(ctx.accounts.savings._id),
      toAccountId: null,
      occurredAt: "2026-10-22T07:50:00.000Z",
      tzid: "Asia/Kolkata",
      localDate: "2026-10-22",
      note: "Lunch",
      recurrenceId: null,
      installmentPlanId: null,
      installmentIndex: null,
      installmentCount: null,
      createdOn: "web",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("creates income and transfer entries", async () => {
    const ctx = await setup();
    const income = await post(ctx, {
      ...expenseBody(ctx),
      type: "income",
      categoryId: String(ctx.categories.salary._id),
    });
    expect(income.status).toBe(201);
    const transfer = await post(ctx, {
      type: "transfer",
      amountMinor: 5000,
      accountId: String(ctx.accounts.savings._id),
      toAccountId: String(ctx.accounts.wallet._id),
      occurredAt: "2026-10-22T07:50:00.000Z",
      tzid: "Asia/Kolkata",
    });
    expect(transfer.status).toBe(201);
    expect(transfer.body.data.categoryId).toBeNull();
    expect(transfer.body.data.toAccountId).toBe(String(ctx.accounts.wallet._id));
  });

  it("computes localDate in the recorded zone and stores createdOn from the header", async () => {
    const ctx = await setup();
    const res = await post(ctx, expenseBody(ctx, { occurredAt: "2026-10-22T20:00:00.000Z" }), {
      "X-Client-Platform": "ios",
    });
    expect(res.body.data.localDate).toBe("2026-10-23");
    expect(res.body.data.createdOn).toBe("ios");
  });

  it("rejects an unknown client platform", async () => {
    const ctx = await setup();
    const res = await post(ctx, expenseBody(ctx), { "X-Client-Platform": "palm" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post(BASE).send({});
    expect(res.status).toBe(401);
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it.each([
    ["float amount", { amountMinor: 10.5 }],
    ["zero amount", { amountMinor: 0 }],
    ["negative amount", { amountMinor: -5 }],
    ["unknown field", { foo: 1 }],
    ["bad zone", { tzid: "Mars/Base" }],
    ["note too long", { note: "x".repeat(141) }],
    ["bad date", { occurredAt: "yesterday" }],
    ["more than a year ahead", { occurredAt: "2099-01-01T00:00:00.000Z" }],
  ])("rejects %s with 400", async (_name, extra) => {
    const ctx = await setup();
    const res = await post(ctx, expenseBody(ctx, extra));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces every ledger rule with its error code", async () => {
    const ctx = await setup();
    const s = String(ctx.accounts.savings._id);
    const w = String(ctx.accounts.wallet._id);
    const food = String(ctx.categories.food._id);
    const salary = String(ctx.categories.salary._id);
    const cases = [
      [{ categoryId: null }, 400, "CATEGORY_REQUIRED"],
      [{ type: "transfer", toAccountId: w }, 400, "CATEGORY_NOT_ALLOWED"],
      [{ categoryId: salary }, 400, "CATEGORY_KIND_MISMATCH"],
      [{ type: "transfer", categoryId: null }, 400, "TRANSFER_TARGET_REQUIRED"],
      [{ toAccountId: w }, 400, "TRANSFER_TARGET_NOT_ALLOWED"],
      [{ type: "transfer", categoryId: null, toAccountId: s }, 400, "TRANSFER_SAME_ACCOUNT"],
      [
        {
          type: "transfer",
          categoryId: null,
          accountId: String(ctx.accounts.debit._id),
          toAccountId: w,
        },
        400,
        "DEBIT_CARD_TRANSFER",
      ],
    ];
    for (const [extra, status, code] of cases) {
      const res = await post(ctx, expenseBody(ctx, { categoryId: food, ...extra }));
      expect([res.status, res.body.error.code]).toEqual([status, code]);
    }

    await Account.updateOne({ _id: w }, { archivedAt: new Date() });
    const archivedAccount = await post(ctx, expenseBody(ctx, { accountId: w }));
    expect([archivedAccount.status, archivedAccount.body.error.code]).toEqual([
      409,
      "ACCOUNT_ARCHIVED",
    ]);
    await Category.updateOne({ _id: food }, { archivedAt: new Date() });
    const archivedCategory = await post(ctx, expenseBody(ctx));
    expect([archivedCategory.status, archivedCategory.body.error.code]).toEqual([
      409,
      "CATEGORY_ARCHIVED",
    ]);
  });

  it("returns 404 for another user's account or category", async () => {
    const ctx = await setup();
    const other = await setup();
    const foreignAccount = await post(
      ctx,
      expenseBody(ctx, { accountId: String(other.accounts.savings._id) }),
    );
    expect(foreignAccount.status).toBe(404);
    const foreignCategory = await post(
      ctx,
      expenseBody(ctx, { categoryId: String(other.categories.food._id) }),
    );
    expect(foreignCategory.status).toBe(404);
  });

  it("creates instalments that sum exactly with clamped month-end dates", async () => {
    const ctx = await setup();
    const res = await post(
      ctx,
      expenseBody(ctx, {
        amountMinor: 100001,
        accountId: String(ctx.accounts.card._id),
        occurredAt: "2026-01-31T10:00:00.000Z",
        tzid: "UTC",
        instalments: { months: 6 },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.installmentIndex).toBe(1);
    expect(res.body.data.installmentCount).toBe(6);

    const rows = await Transaction.find({ installmentPlanId: res.body.data.installmentPlanId })
      .sort({ installmentIndex: 1 })
      .lean();
    expect(rows).toHaveLength(6);
    expect(rows.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(100001);
    expect(rows[0].amountMinor).toBe(16671);
    expect(rows.map((row) => row.localDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(await InstallmentPlan.countDocuments()).toBe(1);
  });

  it("allows instalments only for credit-card expenses", async () => {
    const ctx = await setup();
    const res = await post(ctx, expenseBody(ctx, { instalments: { months: 3 } }));
    expect([res.status, res.body.error.code]).toEqual([400, "INSTALMENTS_NOT_ALLOWED"]);
    const bad = await post(ctx, expenseBody(ctx, { instalments: { months: 5 } }));
    expect(bad.status).toBe(400);
  });

  it("creates a repeat rule and links the entry", async () => {
    const ctx = await setup();
    const res = await post(
      ctx,
      expenseBody(ctx, { repeat: { freq: "monthly", interval: 1, endsOn: null } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.recurrenceId).toEqual(expect.any(String));
    const rule = await RecurrenceRule.findById(res.body.data.recurrenceId).lean();
    expect(rule.nextOccurrenceDate).toBe("2026-11-22");
    expect(rule.startsOn).toBe("2026-10-22");
    expect(rule.localTime).toBe("13:20");
    const entry = await Transaction.findById(res.body.data.id).lean();
    expect(entry.occurrenceDate).toBe("2026-10-22");
  });

  it("rejects repeat with instalments and an end before the start", async () => {
    const ctx = await setup();
    const both = await post(
      ctx,
      expenseBody(ctx, {
        accountId: String(ctx.accounts.card._id),
        repeat: { freq: "monthly" },
        instalments: { months: 3 },
      }),
    );
    expect([both.status, both.body.error.code]).toEqual([400, "REPEAT_WITH_INSTALMENTS"]);
    const early = await post(
      ctx,
      expenseBody(ctx, { repeat: { freq: "monthly", endsOn: "2026-01-01" } }),
    );
    expect(early.status).toBe(400);
    expect(await RecurrenceRule.countDocuments()).toBe(0);
  });

  it("is idempotent for the same key and body", async () => {
    const ctx = await setup();
    const key = "6f1d3c0e-2b0a-4a43-9d1e-0c4f6c1c9a11";
    const first = await post(ctx, expenseBody(ctx), { "Idempotency-Key": key });
    const second = await post(ctx, expenseBody(ctx), { "Idempotency-Key": key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await Transaction.countDocuments()).toBe(1);

    const other = await post(ctx, expenseBody(ctx, { amountMinor: 1 }), { "Idempotency-Key": key });
    expect([other.status, other.body.error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
  });
});

describe("GET /transactions/:id, PATCH, DELETE, restore, duplicate", () => {
  async function created(ctx, extra = {}) {
    const res = await post(ctx, expenseBody(ctx, extra));
    return res.body.data;
  }

  it("reads one entry and hides other users' entries", async () => {
    const ctx = await setup();
    const other = await setup();
    const tx = await created(ctx);
    const res = await request(app).get(`${BASE}/${tx.id}`).set(ctx.headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(tx);
    expect((await request(app).get(`${BASE}/${tx.id}`).set(other.headers)).status).toBe(404);
    expect((await request(app).get(`${BASE}/not-an-id`).set(ctx.headers)).status).toBe(400);
    expect((await request(app).get(`${BASE}/${tx.id}`)).status).toBe(401);
  });

  it("patches a subset, recomputes localDate and clears the note", async () => {
    const ctx = await setup();
    const tx = await created(ctx);
    const res = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(ctx.headers)
      .send({ amountMinor: 30000, occurredAt: "2026-10-22T20:00:00.000Z", note: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      amountMinor: 30000,
      localDate: "2026-10-23",
      note: null,
      categoryId: tx.categoryId,
    });
    const empty = await request(app).patch(`${BASE}/${tx.id}`).set(ctx.headers).send({});
    expect(empty.status).toBe(400);
    const unknown = await request(app).patch(`${BASE}/${tx.id}`).set(ctx.headers).send({ x: 1 });
    expect(unknown.status).toBe(400);
  });

  it("changes type to transfer only with the right fields", async () => {
    const ctx = await setup();
    const tx = await created(ctx);
    const wallet = String(ctx.accounts.wallet._id);
    const bad = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(ctx.headers)
      .send({ type: "transfer", toAccountId: wallet });
    expect(bad.body.error.code).toBe("CATEGORY_NOT_ALLOWED");
    const good = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(ctx.headers)
      .send({ type: "transfer", categoryId: null, toAccountId: wallet });
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({
      type: "transfer",
      categoryId: null,
      toAccountId: wallet,
    });
  });

  it("lets an edit keep an archived reference but not choose a new one", async () => {
    const ctx = await setup();
    const tx = await created(ctx);
    await Category.updateOne({ _id: ctx.categories.food._id }, { archivedAt: new Date() });
    const keep = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(ctx.headers)
      .send({ amountMinor: 1 });
    expect(keep.status).toBe(200);
    await Category.updateOne({ _id: ctx.categories.transport._id }, { archivedAt: new Date() });
    const pick = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(ctx.headers)
      .send({ categoryId: String(ctx.categories.transport._id) });
    expect([pick.status, pick.body.error.code]).toEqual([409, "CATEGORY_ARCHIVED"]);
  });

  it("does not let another user patch, delete or restore", async () => {
    const ctx = await setup();
    const other = await setup();
    const tx = await created(ctx);
    const patch = await request(app)
      .patch(`${BASE}/${tx.id}`)
      .set(other.headers)
      .send({ amountMinor: 1 });
    expect(patch.status).toBe(404);
    expect((await request(app).delete(`${BASE}/${tx.id}`).set(other.headers)).status).toBe(404);
    expect(
      (await request(app).get(`${BASE}/${tx.id}`).set(ctx.headers)).body.data.amountMinor,
    ).toBe(24000);
  });

  it("soft-deletes, hides and restores", async () => {
    const ctx = await setup();
    const tx = await created(ctx);
    const del = await request(app).delete(`${BASE}/${tx.id}`).set(ctx.headers);
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(tx.id);
    const gap = Date.parse(del.body.data.undoUntil) - Date.parse(del.body.data.deletedAt);
    expect(gap).toBe(10000);

    expect((await request(app).get(`${BASE}/${tx.id}`).set(ctx.headers)).status).toBe(404);
    expect((await request(app).get(BASE).set(ctx.headers)).body.data).toHaveLength(0);
    expect((await request(app).delete(`${BASE}/${tx.id}`).set(ctx.headers)).status).toBe(404);

    const other = await setup();
    expect((await request(app).post(`${BASE}/${tx.id}/restore`).set(other.headers)).status).toBe(
      404,
    );
    const restored = await request(app).post(`${BASE}/${tx.id}/restore`).set(ctx.headers);
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(tx.id);
    expect((await request(app).post(`${BASE}/${tx.id}/restore`).set(ctx.headers)).status).toBe(404);
    expect((await request(app).get(`${BASE}/${tx.id}`).set(ctx.headers)).status).toBe(200);
  });

  it("duplicates without recurrence or instalment links", async () => {
    const ctx = await setup();
    const tx = await created(ctx, { repeat: { freq: "weekly" } });
    const res = await request(app).post(`${BASE}/${tx.id}/duplicate`).set(ctx.headers).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(tx.id);
    expect(res.body.data).toMatchObject({
      amountMinor: 24000,
      note: "Lunch",
      tzid: "Asia/Kolkata",
      recurrenceId: null,
    });
    const dated = await request(app)
      .post(`${BASE}/${tx.id}/duplicate`)
      .set(ctx.headers)
      .send({ occurredAt: "2026-11-01T00:00:00.000Z", tzid: "UTC" });
    expect(dated.body.data).toMatchObject({ localDate: "2026-11-01", tzid: "UTC" });

    await Category.updateOne({ _id: ctx.categories.food._id }, { archivedAt: new Date() });
    const archived = await request(app)
      .post(`${BASE}/${tx.id}/duplicate`)
      .set(ctx.headers)
      .send({});
    expect([archived.status, archived.body.error.code]).toEqual([409, "CATEGORY_ARCHIVED"]);

    const other = await setup();
    const foreign = await request(app)
      .post(`${BASE}/${tx.id}/duplicate`)
      .set(other.headers)
      .send({});
    expect(foreign.status).toBe(404);
    expect((await request(app).post(`${BASE}/${tx.id}/duplicate`).send({})).status).toBe(401);
  });
});

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe("amount and date guards", () => {
  it("rejects instalments when the amount is smaller than the number of months", async () => {
    const ctx = await setup();

    const res = await post(
      ctx,
      expenseBody(ctx, {
        amountMinor: 2,
        accountId: String(ctx.accounts.card._id),
        instalments: { months: 3 },
      }),
    );

    expect([res.status, res.body.error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(res.body.error.details).toEqual([
      {
        field: "body.instalments.months",
        message: "Amount is too small to split into that many instalments",
      },
    ]);
    expect(await Transaction.countDocuments()).toBe(0);
    expect(await InstallmentPlan.countDocuments()).toBe(0);
  });

  it("limits occurredAt to the last 10 years and one year ahead on create, patch and duplicate", async () => {
    const ctx = await setup();
    const tooOld = daysFromNow(-3700);
    const tooFar = daysFromNow(400);

    expect((await post(ctx, expenseBody(ctx, { occurredAt: tooOld }))).status).toBe(400);
    expect((await post(ctx, expenseBody(ctx, { occurredAt: tooFar }))).status).toBe(400);
    expect((await post(ctx, expenseBody(ctx, { occurredAt: daysFromNow(-3000) }))).status).toBe(
      201,
    );

    const entry = (await post(ctx, expenseBody(ctx))).body.data;
    const patch = await request(app)
      .patch(`${BASE}/${entry.id}`)
      .set(ctx.headers)
      .send({ occurredAt: tooOld });
    const duplicate = await request(app)
      .post(`${BASE}/${entry.id}/duplicate`)
      .set(ctx.headers)
      .send({ occurredAt: tooOld });
    expect(patch.status).toBe(400);
    expect(duplicate.status).toBe(400);
  });

  it("requires repeating and instalment entries to start within the last year", async () => {
    const ctx = await setup();
    const old = daysFromNow(-400);

    const repeat = await post(
      ctx,
      expenseBody(ctx, { occurredAt: old, repeat: { freq: "monthly" } }),
    );
    const instalments = await post(
      ctx,
      expenseBody(ctx, {
        occurredAt: old,
        accountId: String(ctx.accounts.card._id),
        instalments: { months: 3 },
      }),
    );

    expect([repeat.status, repeat.body.error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(repeat.body.error.details[0].field).toBe("body.occurredAt");
    expect(instalments.status).toBe(400);
    expect(await Transaction.countDocuments()).toBe(0);
    expect(await RecurrenceRule.countDocuments()).toBe(0);
  });

  it("caps active repeat rules at 100", async () => {
    const ctx = await setup();
    await RecurrenceRule.insertMany(
      Array.from({ length: 100 }, () => ({
        userId: ctx.userId,
        template: {
          type: "expense",
          amountMinor: 100,
          categoryId: ctx.categories.food._id,
          accountId: ctx.accounts.savings._id,
        },
        tzid: "Asia/Kolkata",
        localTime: "09:00",
        freq: "monthly",
        interval: 1,
        anchorDay: 5,
        anchorMonth: 10,
        startsOn: "2026-10-05",
        nextOccurrenceDate: "2026-11-05",
      })),
    );

    const res = await post(ctx, expenseBody(ctx, { repeat: { freq: "monthly" } }));

    expect([res.status, res.body.error.code]).toEqual([409, "LIMIT_REACHED"]);
  });
});

describe("idempotency with a dead request", () => {
  const key = "0b8f7f0e-5a43-4d0e-8c11-6f0f5c1d2a77";

  it("takes over a stale in-progress claim and refuses a fresh one", async () => {
    const ctx = await setup();
    await post(ctx, expenseBody(ctx), { "Idempotency-Key": key });
    const asInProgress = (claimedAt) =>
      IdempotencyKey.updateOne(
        { key },
        { $set: { status: "in_progress", claimedAt }, $unset: { responseBody: 1 } },
      );

    await asInProgress(new Date());
    const fresh = await post(ctx, expenseBody(ctx), { "Idempotency-Key": key });
    expect([fresh.status, fresh.body.error.code]).toEqual([409, "IDEMPOTENCY_IN_PROGRESS"]);

    await asInProgress(new Date(Date.now() - 120_000));
    const retried = await post(ctx, expenseBody(ctx), { "Idempotency-Key": key });
    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(await Transaction.countDocuments()).toBe(2);

    await asInProgress(new Date(Date.now() - 120_000));
    const different = await post(ctx, expenseBody(ctx, { amountMinor: 1 }), {
      "Idempotency-Key": key,
    });
    expect([different.status, different.body.error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
  });

  it("claims again when the row vanishes between the duplicate error and the read", async () => {
    const ctx = await setup();
    await IdempotencyKey.create({
      userId: ctx.userId,
      key,
      route: "POST /x",
      requestHash: "h",
      status: "in_progress",
      claimedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Simulates the other request releasing the key right after our insert collided.
    const spy = vi.spyOn(IdempotencyKey, "findOne").mockImplementationOnce(() => ({
      lean: async () => {
        await IdempotencyKey.deleteMany({ key });
        return null;
      },
    }));

    const result = await idempotencyRepository.claim(ctx.userId, {
      key,
      route: "POST /x",
      requestHash: "h",
    });

    spy.mockRestore();
    expect(result).toEqual({ claimed: true });
  });
});

describe("export truncation and rate limits", () => {
  it("flags a truncated export and keeps the newest rows", async () => {
    const ctx = await setup();
    for (const day of ["2026-10-20", "2026-10-21", "2026-10-22"]) {
      await post(ctx, expenseBody(ctx, { occurredAt: `${day}T07:00:00.000Z` }));
    }

    const small = await exportService.exportCsv(ctx.userId, {}, { limit: 2 });
    const all = await exportService.exportCsv(ctx.userId, {}, { limit: 3 });

    expect(small.truncated).toBe(true);
    expect(small.csv.trim().split("\r\n")).toHaveLength(3);
    expect(small.csv).toContain("2026-10-22");
    expect(small.csv).not.toContain("2026-10-20");
    expect(all.truncated).toBe(false);
    const res = await request(app).get(`${BASE}/export.csv`).set(ctx.headers);
    expect(res.headers["x-export-truncated"]).toBeUndefined();
  });

  it("limits exports to 10 per 15 minutes per user", async () => {
    const ctx = await setup();
    const other = await setup();
    for (let index = 0; index < 10; index += 1) {
      expect((await request(app).get(`${BASE}/export.csv`).set(ctx.headers)).status).toBe(200);
    }

    const blocked = await request(app).get(`${BASE}/export.csv`).set(ctx.headers);

    expect([blocked.status, blocked.body.error.code]).toEqual([429, "RATE_LIMITED"]);
    expect((await request(app).get(`${BASE}/export.csv`).set(other.headers)).status).toBe(200);
  });

  it("limits writes to 300 per 5 minutes per user and never limits reads", async () => {
    const ctx = await setup();
    const write = () => request(app).post(BASE).set(ctx.headers).send({});
    for (let index = 0; index < 300; index += 1) {
      const res = await write();
      if (res.status !== 400) throw new Error(`write ${index} got ${res.status}`);
    }

    const blocked = await write();

    expect([blocked.status, blocked.body.error.code]).toEqual([429, "RATE_LIMITED"]);
    expect((await request(app).get(BASE).set(ctx.headers)).status).toBe(200);
  });
});
