import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error.js";
import { notFound } from "../../src/middleware/not-found.js";
import { requestId } from "../../src/middleware/request-id.js";
import { RecurrenceRule } from "../../src/models/recurrence-rule.model.js";
import { recurrenceRouter } from "../../src/routes/v1/recurrence.route.js";
import { todayIn } from "../../src/utils/time.js";
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

const app = createTestApp("/recurrences", recurrenceRouter);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

async function setup() {
  const me = await createSignedInUser();
  const ledger = await seedLedger(me.userId);
  const makeRule = (overrides = {}) =>
    RecurrenceRule.create({
      userId: me.userId,
      template: {
        type: "expense",
        amountMinor: 600000,
        categoryId: ledger.categories.rent._id,
        accountId: ledger.accounts.savings._id,
        note: "Rent",
      },
      tzid: "Asia/Kolkata",
      localTime: "09:00",
      freq: "monthly",
      interval: 1,
      anchorDay: 5,
      anchorMonth: 10,
      startsOn: "2026-10-05",
      nextOccurrenceDate: "2026-11-05",
      ...overrides,
    });
  return { ...me, ledger, makeRule };
}

describe("GET /recurrences", () => {
  it("returns the contract shape", async () => {
    const { makeRule, headers, ledger } = await setup();
    const rule = await makeRule();

    const res = await request(app).get("/recurrences").set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: String(rule._id),
        type: "expense",
        amountMinor: 600000,
        categoryId: String(ledger.categories.rent._id),
        accountId: String(ledger.accounts.savings._id),
        toAccountId: null,
        note: "Rent",
        tzid: "Asia/Kolkata",
        localTime: "09:00",
        freq: "monthly",
        interval: 1,
        startsOn: "2026-10-05",
        endsOn: null,
        nextOccurrence: "2026-11-05",
        paused: false,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("lists active rules first by next date, hides stopped ones and other users' rules", async () => {
    const { makeRule, headers } = await setup();
    const late = await makeRule({ nextOccurrenceDate: "2026-12-01", note: undefined });
    const soon = await makeRule({ nextOccurrenceDate: "2026-11-01" });
    const paused = await makeRule({ nextOccurrenceDate: "2026-10-20", pausedAt: new Date() });
    await makeRule({ stoppedAt: new Date() });
    const other = await setup();
    await other.makeRule();

    const res = await request(app).get("/recurrences").set(headers);
    expect(res.body.data.map((r) => r.id)).toEqual([soon, late, paused].map((r) => String(r._id)));
    expect(res.body.data[2].paused).toBe(true);
  });

  it("reports nextOccurrence null once past the end date", async () => {
    const { makeRule, headers } = await setup();
    await makeRule({ endsOn: "2026-10-31", nextOccurrenceDate: "2026-11-05" });
    const res = await request(app).get("/recurrences").set(headers);
    expect(res.body.data[0]).toMatchObject({ endsOn: "2026-10-31", nextOccurrence: null });
  });

  it("requires auth", async () => {
    expect((await request(app).get("/recurrences")).status).toBe(401);
  });
});

describe("PATCH /recurrences/:id", () => {
  it("updates amount, note and end date, and clears them", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule();
    const patch = (body) => request(app).patch(`/recurrences/${rule._id}`).set(headers).send(body);

    const res = await patch({ amountMinor: 650000, note: "New rent", endsOn: "2027-03-05" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      amountMinor: 650000,
      note: "New rent",
      endsOn: "2027-03-05",
    });

    const cleared = await patch({ endsOn: null, note: null });
    expect(cleared.body.data).toMatchObject({ endsOn: null, note: null, amountMinor: 650000 });
  });

  it("pauses and resumes", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule();
    const patch = (body) => request(app).patch(`/recurrences/${rule._id}`).set(headers).send(body);

    expect((await patch({ paused: true })).body.data.paused).toBe(true);
    expect((await RecurrenceRule.findById(rule._id)).pausedAt).toBeInstanceOf(Date);
    expect((await patch({ paused: false })).body.data.paused).toBe(false);
    expect((await RecurrenceRule.findById(rule._id)).pausedAt).toBeUndefined();
  });

  it("rejects an end date before the start date, empty and unknown bodies", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule();
    const patch = (body) => request(app).patch(`/recurrences/${rule._id}`).set(headers).send(body);

    expect((await patch({ endsOn: "2026-10-04" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ interval: 2 })).status).toBe(400);
    expect((await patch({ amountMinor: 0 })).status).toBe(400);
    expect((await patch({ paused: "yes" })).status).toBe(400);
    expect(
      (await request(app).patch("/recurrences/bad").set(headers).send({ paused: true })).status,
    ).toBe(400);
  });

  it("404s for other users' and stopped rules, leaving them unchanged", async () => {
    const mine = await setup();
    const rule = await mine.makeRule();
    const stopped = await mine.makeRule({ stoppedAt: new Date() });
    const other = await createSignedInUser();

    const cross = await request(app)
      .patch(`/recurrences/${rule._id}`)
      .set(other.headers)
      .send({ amountMinor: 1 });
    expect(cross.status).toBe(404);
    expect((await RecurrenceRule.findById(rule._id)).template.amountMinor).toBe(600000);

    const gone = await request(app)
      .patch(`/recurrences/${stopped._id}`)
      .set(mine.headers)
      .send({ amountMinor: 1 });
    expect(gone.status).toBe(404);
    expect(
      (await request(app).patch(`/recurrences/${rule._id}`).send({ amountMinor: 1 })).status,
    ).toBe(401);
  });
});

describe("DELETE /recurrences/:id", () => {
  it("stops the rule with 204 and hides it", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule();

    expect((await request(app).delete(`/recurrences/${rule._id}`).set(headers)).status).toBe(204);
    expect((await RecurrenceRule.findById(rule._id)).stoppedAt).toBeInstanceOf(Date);
    expect((await request(app).get("/recurrences").set(headers)).body.data).toEqual([]);
    expect((await request(app).delete(`/recurrences/${rule._id}`).set(headers)).status).toBe(404);
  });

  it("404s for another user's rule and requires auth", async () => {
    const mine = await setup();
    const rule = await mine.makeRule();
    const other = await createSignedInUser();

    expect((await request(app).delete(`/recurrences/${rule._id}`).set(other.headers)).status).toBe(
      404,
    );
    expect((await RecurrenceRule.findById(rule._id)).stoppedAt).toBeUndefined();
    expect((await request(app).delete(`/recurrences/${rule._id}`)).status).toBe(401);
    expect((await request(app).delete("/recurrences/nope").set(mine.headers)).status).toBe(400);
  });
});

describe("PATCH /recurrences/:id resume", () => {
  it("resumes from the first occurrence on or after today without backfilling", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule({
      freq: "daily",
      startsOn: "2020-01-01",
      nextOccurrenceDate: "2020-01-01",
      pausedAt: new Date(),
    });

    const res = await request(app)
      .patch(`/recurrences/${rule._id}`)
      .set(headers)
      .send({ paused: false });

    expect(res.status).toBe(200);
    expect(res.body.data.paused).toBe(false);
    expect(res.body.data.nextOccurrence).toBe(todayIn("Asia/Kolkata"));
    expect((await RecurrenceRule.findById(rule._id)).nextOccurrenceDate).toBe(
      todayIn("Asia/Kolkata"),
    );
  });

  it("keeps a future next date when resuming", async () => {
    const { makeRule, headers } = await setup();
    const rule = await makeRule({ nextOccurrenceDate: "2099-01-05", pausedAt: new Date() });

    const res = await request(app)
      .patch(`/recurrences/${rule._id}`)
      .set(headers)
      .send({ paused: false });

    expect(res.body.data.nextOccurrence).toBe("2099-01-05");
  });
});
