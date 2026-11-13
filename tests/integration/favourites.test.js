import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { Account } from "../../src/models/account.model.js";
import { Favourite } from "../../src/models/favourite.model.js";
import { favouriteRouter } from "../../src/routes/v1/favourite.route.js";
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

const app = createTestApp("/favourites", favouriteRouter);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

async function setup() {
  const me = await createSignedInUser();
  const ledger = await seedLedger(me.userId);
  const body = (overrides = {}) => ({
    title: "Lunch",
    icon: "food",
    type: "expense",
    amountMinor: 24000,
    categoryId: String(ledger.categories.food._id),
    accountId: String(ledger.accounts.savings._id),
    note: "Lunch",
    ...overrides,
  });
  const create = (overrides) =>
    request(app).post("/favourites").set(me.headers).send(body(overrides));
  return { ...me, ledger, body, create };
}

describe("POST /favourites", () => {
  it("creates a favourite with the contract shape and appends the sort order", async () => {
    const { create, ledger } = await setup();

    const first = await create();
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({
      id: expect.any(String),
      title: "Lunch",
      icon: "food",
      type: "expense",
      amountMinor: 24000,
      categoryId: String(ledger.categories.food._id),
      accountId: String(ledger.accounts.savings._id),
      toAccountId: null,
      note: "Lunch",
      sortOrder: 0,
      createdAt: expect.any(String),
    });
    const second = await create({ title: "Dinner" });
    expect(second.body.data.sortOrder).toBe(1);
  });

  it("creates a transfer favourite", async () => {
    const { create, ledger } = await setup();
    const res = await create({
      type: "transfer",
      categoryId: undefined,
      toAccountId: String(ledger.accounts.wallet._id),
      note: undefined,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: "transfer",
      categoryId: null,
      note: null,
      toAccountId: String(ledger.accounts.wallet._id),
    });
  });

  it("applies the transaction rules", async () => {
    const { create, ledger } = await setup();
    const code = async (overrides) => (await create(overrides)).body.error.code;
    expect(await code({ categoryId: undefined })).toBe("CATEGORY_REQUIRED");
    expect(await code({ categoryId: String(ledger.categories.salary._id) })).toBe(
      "CATEGORY_KIND_MISMATCH",
    );
    expect(await code({ toAccountId: String(ledger.accounts.wallet._id) })).toBe(
      "TRANSFER_TARGET_NOT_ALLOWED",
    );
    expect(await code({ type: "transfer", categoryId: undefined })).toBe(
      "TRANSFER_TARGET_REQUIRED",
    );
    expect(await code({ accountId: "a".repeat(24) })).toBe("NOT_FOUND");

    await Account.updateOne({ _id: ledger.accounts.savings._id }, { archivedAt: new Date() });
    expect(await code()).toBe("ACCOUNT_ARCHIVED");
  });

  it("validates the body and requires auth", async () => {
    const { create, body } = await setup();
    expect((await create({ title: "" })).status).toBe(400);
    expect((await create({ title: "x".repeat(41) })).status).toBe(400);
    expect((await create({ icon: "🍔" })).status).toBe(400);
    expect((await create({ amountMinor: 0 })).status).toBe(400);
    expect((await create({ extra: 1 })).status).toBe(400);
    expect((await request(app).post("/favourites").send(body())).status).toBe(401);
  });
});

describe("GET /favourites", () => {
  it("lists only my favourites, sorted", async () => {
    const mine = await setup();
    await mine.create({ title: "A" });
    await mine.create({ title: "B" });
    const other = await setup();
    await other.create({ title: "Theirs" });

    const res = await request(app).get("/favourites").set(mine.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.map((f) => f.title)).toEqual(["A", "B"]);
    expect((await request(app).get("/favourites")).status).toBe(401);
  });
});

describe("PATCH /favourites/:id", () => {
  it("updates fields and clears nullable ones", async () => {
    const { create, headers } = await setup();
    const { id } = (await create()).body.data;

    const res = await request(app)
      .patch(`/favourites/${id}`)
      .set(headers)
      .send({ title: "Brunch", amountMinor: 30000, note: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Brunch", amountMinor: 30000, note: null });
  });

  it("re-checks the rules on the merged result", async () => {
    const { create, headers, ledger } = await setup();
    const { id } = (await create()).body.data;
    const patch = (body) => request(app).patch(`/favourites/${id}`).set(headers).send(body);

    const toTransfer = await patch({
      type: "transfer",
      toAccountId: String(ledger.accounts.wallet._id),
    });
    expect(toTransfer.body.error.code).toBe("CATEGORY_NOT_ALLOWED");

    const ok = await patch({
      type: "transfer",
      categoryId: null,
      toAccountId: String(ledger.accounts.wallet._id),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ type: "transfer", categoryId: null });
  });

  it("keeps an already-used archived account but rejects switching to one", async () => {
    const { create, headers, ledger } = await setup();
    const { id } = (await create()).body.data;
    await Account.updateOne({ _id: ledger.accounts.savings._id }, { archivedAt: new Date() });
    await Account.updateOne({ _id: ledger.accounts.wallet._id }, { archivedAt: new Date() });

    const keep = await request(app).patch(`/favourites/${id}`).set(headers).send({ title: "Keep" });
    expect(keep.status).toBe(200);
    const move = await request(app)
      .patch(`/favourites/${id}`)
      .set(headers)
      .send({ accountId: String(ledger.accounts.wallet._id) });
    expect(move.body.error.code).toBe("ACCOUNT_ARCHIVED");
  });

  it("rejects empty bodies, unknown fields and bad ids; hides other users' records", async () => {
    const mine = await setup();
    const { id } = (await mine.create()).body.data;
    const patch = (path, body, headers = mine.headers) =>
      request(app).patch(path).set(headers).send(body);

    expect((await patch(`/favourites/${id}`, {})).status).toBe(400);
    expect((await patch(`/favourites/${id}`, { nope: 1 })).status).toBe(400);
    expect((await patch("/favourites/xyz", { title: "x" })).status).toBe(400);
    expect((await patch(`/favourites/${"b".repeat(24)}`, { title: "x" })).status).toBe(404);

    const other = await createSignedInUser();
    const res = await patch(`/favourites/${id}`, { title: "Hacked" }, other.headers);
    expect(res.status).toBe(404);
    expect((await Favourite.findById(id)).title).toBe("Lunch");
    expect((await request(app).patch(`/favourites/${id}`).send({ title: "x" })).status).toBe(401);
  });
});

describe("DELETE /favourites/:id", () => {
  it("deletes with 204 and 404s afterwards", async () => {
    const { create, headers } = await setup();
    const { id } = (await create()).body.data;
    expect((await request(app).delete(`/favourites/${id}`).set(headers)).status).toBe(204);
    expect((await request(app).delete(`/favourites/${id}`).set(headers)).status).toBe(404);
  });

  it("does not delete another user's favourite", async () => {
    const mine = await setup();
    const { id } = (await mine.create()).body.data;
    const other = await createSignedInUser();
    expect((await request(app).delete(`/favourites/${id}`).set(other.headers)).status).toBe(404);
    expect(await Favourite.countDocuments({ _id: id })).toBe(1);
    expect((await request(app).delete(`/favourites/${id}`)).status).toBe(401);
  });
});

describe("PUT /favourites/order", () => {
  it("reorders and keeps unlisted favourites after the listed ones", async () => {
    const { create, headers } = await setup();
    const a = (await create({ title: "A" })).body.data.id;
    const b = (await create({ title: "B" })).body.data.id;
    const c = (await create({ title: "C" })).body.data.id;

    const res = await request(app)
      .put("/favourites/order")
      .set(headers)
      .send({ ids: [c, a] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((f) => f.id)).toEqual([c, a, b]);
    expect(res.body.data.map((f) => f.sortOrder)).toEqual([0, 1, 2]);

    const list = await request(app).get("/favourites").set(headers);
    expect(list.body.data.map((f) => f.id)).toEqual([c, a, b]);
  });

  it("rejects duplicates, bad bodies and other users' ids", async () => {
    const mine = await setup();
    const a = (await mine.create()).body.data.id;
    const put = (body, headers = mine.headers) =>
      request(app).put("/favourites/order").set(headers).send(body);

    expect((await put({ ids: [a, a] })).status).toBe(400);
    expect((await put({ ids: [] })).status).toBe(400);
    expect((await put({ ids: [a], extra: 1 })).status).toBe(400);
    expect((await put({ ids: ["nope"] })).status).toBe(400);

    const other = await setup();
    const b = (await other.create()).body.data.id;
    expect((await put({ ids: [a, b] })).status).toBe(404);
    expect(
      (
        await request(app)
          .put("/favourites/order")
          .send({ ids: [a] })
      ).status,
    ).toBe(401);
  });
});

describe("favourite limit", () => {
  it("rejects the 101st favourite with LIMIT_REACHED", async () => {
    const { create, userId, ledger } = await setup();
    await Favourite.insertMany(
      Array.from({ length: 100 }, (_, index) => ({
        userId,
        title: `Fav ${index}`,
        icon: "food",
        type: "expense",
        amountMinor: 100,
        categoryId: ledger.categories.food._id,
        accountId: ledger.accounts.savings._id,
        sortOrder: index,
      })),
    );

    const res = await create();

    expect([res.status, res.body.error.code]).toEqual([409, "LIMIT_REACHED"]);
  });
});
