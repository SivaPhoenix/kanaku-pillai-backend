import cookieParser from "cookie-parser";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { Category } from "../../src/models/category.model.js";
import { Favourite } from "../../src/models/favourite.model.js";
import { RecurrenceRule } from "../../src/models/recurrence-rule.model.js";
import { Transaction } from "../../src/models/transaction.model.js";
import { categoryRouter } from "../../src/routes/v1/category.route.js";
import { localDateOf, localMonthOf } from "../../src/utils/time.js";
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

const app = createTestApp("/categories", categoryRouter);
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

async function seeded() {
  const { headers, userId } = await createSignedInUser();
  const ledger = await seedLedger(userId);
  return { headers, userId, ...ledger };
}

describe("GET /categories", () => {
  it("lists with usageThisMonth, filters by kind and archived", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    const entry = (categoryId, extra = {}) =>
      addTx(userId, {
        type: "expense",
        amountMinor: 100,
        accountId: accounts.wallet._id,
        categoryId,
        ...extra,
      });
    await entry(categories.food._id);
    await entry(categories.food._id);
    await entry(categories.food._id, { deletedAt: new Date() });
    await entry(categories.food._id, { occurredAt: new Date("2020-01-15T10:00:00Z") });
    await entry(categories.transport._id);

    const res = await get(headers, "/categories");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    const food = res.body.data.find((c) => c.name === "Food");
    expect(food).toEqual({
      id: String(categories.food._id),
      kind: "expense",
      name: "Food",
      icon: "food",
      color: "c1",
      sortOrder: 0,
      archived: false,
      usageThisMonth: 2,
      createdAt: expect.any(String),
    });
    expect(res.body.data.find((c) => c.name === "Transport").usageThisMonth).toBe(1);
    expect(res.body.data.find((c) => c.name === "Salary").usageThisMonth).toBe(0);

    const income = await get(headers, "/categories?kind=income");
    expect(income.body.data.map((c) => c.name)).toEqual(["Salary", "Freelance"]);

    await post(headers, `/categories/${categories.rent._id}/archive`);
    expect((await get(headers, "/categories?kind=expense")).body.data).toHaveLength(2);
    expect(
      (await get(headers, "/categories?kind=expense&includeArchived=true")).body.data,
    ).toHaveLength(3);
    expect((await get(headers, "/categories?kind=other")).status).toBe(400);
    expect((await request(app).get("/categories")).status).toBe(401);
  });
});

describe("POST /categories", () => {
  const valid = { kind: "expense", name: "Pets", icon: "other", color: "c3" };

  it("creates with the next sort order per kind", async () => {
    const { headers } = await seeded();
    const res = await post(headers, "/categories", valid);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Pets",
      kind: "expense",
      sortOrder: 3,
      usageThisMonth: 0,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/_id|userId|nameKey/);
    const income = await post(headers, "/categories", { ...valid, kind: "income" });
    expect(income.body.data.sortOrder).toBe(2);
  });

  it("rejects bad input, unknown fields and no token", async () => {
    const { headers } = await seeded();
    for (const body of [
      { ...valid, name: " " },
      { ...valid, kind: "transfer" },
      { ...valid, icon: "🍕" },
      { ...valid, color: "red" },
      { ...valid, extra: 1 },
      { name: "x" },
    ]) {
      expect((await post(headers, "/categories", body)).status).toBe(400);
    }
    expect((await request(app).post("/categories").send(valid)).status).toBe(401);
  });

  it("keeps names unique per kind among non-archived", async () => {
    const { headers, categories } = await seeded();
    const clash = await post(headers, "/categories", { ...valid, name: "FOOD" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("NAME_TAKEN");
    expect(
      (await post(headers, "/categories", { ...valid, kind: "income", name: "Food" })).status,
    ).toBe(201);

    await post(headers, `/categories/${categories.food._id}/archive`);
    expect((await post(headers, "/categories", { ...valid, name: "food" })).status).toBe(201);
    const back = await post(headers, `/categories/${categories.food._id}/unarchive`);
    expect(back.status).toBe(409);
  });
});

describe("PATCH /categories/:id", () => {
  it("updates fields and refuses kind changes and name clashes", async () => {
    const { headers, categories } = await seeded();
    const id = categories.food._id;
    const patch = (body, h = headers, target = id) =>
      request(app).patch(`/categories/${target}`).set(h).send(body);

    const res = await patch({ name: "Groceries", icon: "bag", color: "c4" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Groceries",
      icon: "bag",
      color: "c4",
      kind: "expense",
    });

    expect((await patch({ kind: "income" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const clash = await patch({ name: "transport" });
    expect(clash.body.error.code).toBe("NAME_TAKEN");

    const stranger = await createSignedInUser();
    expect((await patch({ name: "Hacked" }, stranger.headers)).status).toBe(404);
    expect((await Category.findById(id)).name).toBe("Groceries");
  });
});

describe("archive and unarchive", () => {
  it("toggles archived and 404s for other users", async () => {
    const { headers, categories } = await seeded();
    const id = categories.rent._id;
    expect((await post(headers, `/categories/${id}/archive`)).body.data.archived).toBe(true);
    expect((await post(headers, `/categories/${id}/unarchive`)).body.data.archived).toBe(false);
    const stranger = await createSignedInUser();
    expect((await post(stranger.headers, `/categories/${id}/archive`)).status).toBe(404);
    expect((await Category.findById(id)).archivedAt).toBeUndefined();
  });
});

describe("DELETE /categories/:id", () => {
  it("deletes an unused category", async () => {
    const { headers, categories } = await seeded();
    const res = await request(app).delete(`/categories/${categories.rent._id}`).set(headers);
    expect(res.status).toBe(204);
    expect(await Category.findById(categories.rent._id)).toBeNull();
  });

  it("blocks with IN_USE for entries (even deleted), favourites and repeat rules", async () => {
    const { headers, userId, accounts, categories } = await seeded();
    const attempt = (id) => request(app).delete(`/categories/${id}`).set(headers);

    await addTx(userId, {
      type: "expense",
      amountMinor: 1,
      accountId: accounts.wallet._id,
      categoryId: categories.food._id,
      deletedAt: new Date(),
    });
    const entry = await attempt(categories.food._id);
    expect(entry.status).toBe(409);
    expect(entry.body.error.code).toBe("IN_USE");

    await Favourite.create({
      userId,
      title: "Bus",
      icon: "bus",
      type: "expense",
      amountMinor: 10,
      categoryId: categories.transport._id,
      accountId: accounts.wallet._id,
    });
    expect((await attempt(categories.transport._id)).body.error.code).toBe("IN_USE");

    await RecurrenceRule.create({
      userId,
      template: {
        type: "expense",
        amountMinor: 5,
        categoryId: categories.rent._id,
        accountId: accounts.wallet._id,
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
    expect((await attempt(categories.rent._id)).body.error.code).toBe("IN_USE");
  });

  it("404s for another user's category", async () => {
    const { categories } = await seeded();
    const stranger = await createSignedInUser();
    const res = await request(app)
      .delete(`/categories/${categories.rent._id}`)
      .set(stranger.headers);
    expect(res.status).toBe(404);
    expect(await Category.findById(categories.rent._id)).not.toBeNull();
    expect((await request(app).delete(`/categories/${categories.rent._id}`)).status).toBe(401);
  });
});

describe("PUT /categories/order", () => {
  it("reorders within a kind and returns that kind's categories", async () => {
    const { headers, categories } = await seeded();
    const ids = [categories.rent._id, categories.food._id, categories.transport._id].map(String);
    const res = await request(app)
      .put("/categories/order")
      .set(headers)
      .send({ kind: "expense", ids });
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(["Rent", "Food", "Transport"]);
    expect(res.body.data.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    const income = await get(headers, "/categories?kind=income");
    expect(income.body.data.map((c) => c.name)).toEqual(["Salary", "Freelance"]);
  });

  it("rejects ids of the wrong kind or owner with 404, and bad bodies with 400", async () => {
    const mine = await seeded();
    const other = await seeded();
    const put = (body, headers = mine.headers) =>
      request(app).put("/categories/order").set(headers).send(body);

    const wrongKind = await put({ kind: "expense", ids: [String(mine.categories.salary._id)] });
    expect(wrongKind.status).toBe(404);
    const foreign = await put({ kind: "expense", ids: [String(other.categories.food._id)] });
    expect(foreign.status).toBe(404);
    expect(
      (await put({ kind: "expense", ids: [String(new mongoose.Types.ObjectId())] })).status,
    ).toBe(404);
    expect((await put({ ids: [String(mine.categories.food._id)] })).status).toBe(400);
    expect((await request(app).put("/categories/order").send({})).status).toBe(401);
    expect((await Category.findById(mine.categories.food._id)).sortOrder).toBe(0);
  });
});

describe("name uniqueness and limits", () => {
  const body = (name, kind = "expense") => ({ kind, name, icon: "food", color: "c1" });
  const post = (headers, path, data) => request(app).post(path).set(headers).send(data);

  it("lets the database pick one winner when the same name is created concurrently", async () => {
    const { headers } = await createSignedInUser();
    await Category.init();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(headers, "/categories", body("Snacks"))),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    for (const res of results.filter((r) => r.status !== 201)) {
      expect([res.status, res.body.error.code]).toEqual([409, "NAME_TAKEN"]);
    }
  });

  it("rejects unarchiving into a taken name", async () => {
    const { headers } = await createSignedInUser();
    const first = await post(headers, "/categories", body("Snacks"));
    await post(headers, `/categories/${first.body.data.id}/archive`);
    await post(headers, "/categories", body("snacks"));

    const res = await post(headers, `/categories/${first.body.data.id}/unarchive`);

    expect([res.status, res.body.error.code]).toEqual([409, "NAME_TAKEN"]);
  });

  it("caps active categories at 100 per kind", async () => {
    const { headers, userId } = await createSignedInUser();
    await Category.insertMany(
      Array.from({ length: 100 }, (_, index) => ({
        userId,
        kind: "expense",
        name: `Cat ${index}`,
        nameKey: `cat ${index}`,
        activeNameKey: `cat ${index}`,
        icon: "food",
        color: "c1",
        sortOrder: index,
      })),
    );

    const full = await post(headers, "/categories", body("One more"));
    const otherKind = await post(headers, "/categories", body("One more", "income"));

    expect([full.status, full.body.error.code]).toEqual([409, "LIMIT_REACHED"]);
    expect(otherKind.status).toBe(201);
  });
});
