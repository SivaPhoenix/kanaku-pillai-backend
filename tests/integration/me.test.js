import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { Account } from "../../src/models/account.model.js";
import { Session } from "../../src/models/session.model.js";
import { Transaction } from "../../src/models/transaction.model.js";
import { User } from "../../src/models/user.model.js";
import { deleteAllForUser } from "../../src/repositories/user-data.repository.js";
import { generateToken, sha256 } from "../../src/utils/crypto.js";
import { hashPassword } from "../../src/utils/password.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser, seedLedger } from "../helpers/ledger.js";

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

const PASSWORD = "Correct-Horse-9";

async function addTx(userId, accountId, categoryId, amountMinor, currencyCode = "INR") {
  return Transaction.create({
    userId,
    type: "expense",
    amountMinor,
    currencyCode,
    categoryId,
    accountId,
    occurredAt: new Date("2026-10-22T07:50:00Z"),
    tzid: "Asia/Kolkata",
    localDate: "2026-10-22",
    localMonth: "2026-10",
    createdOn: "web",
  });
}

async function userWithData(overrides = {}) {
  const me = await createSignedInUser(overrides);
  const ledger = await seedLedger(me.userId);
  return { ...me, ledger };
}

describe("PATCH /api/v1/me", () => {
  it("updates the trimmed name and returns the user", async () => {
    const { headers, userId } = await createSignedInUser();
    const res = await request(app).patch("/api/v1/me").set(headers).send({ name: "  New Name " });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(userId);
    expect(res.body.data.name).toBe("New Name");
    expect(res.body.data).not.toHaveProperty("_id");
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect((await User.findById(userId)).name).toBe("New Name");
  });

  it("rejects blank, long and unknown fields", async () => {
    const { headers } = await createSignedInUser();
    for (const body of [{ name: "   " }, { name: "x".repeat(81) }, { name: "A", email: "a@b.c" }]) {
      const res = await request(app).patch("/api/v1/me").set(headers).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("requires a token", async () => {
    const res = await request(app).patch("/api/v1/me").send({ name: "A" });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/me/settings", () => {
  it("updates non-currency settings without relabelling", async () => {
    const { headers } = await userWithData();
    const res = await request(app)
      .patch("/api/v1/me/settings")
      .set(headers)
      .send({ theme: "dark", weekStart: "sun", tzMode: "manual", tzid: "Asia/Dubai" });
    expect(res.status).toBe(200);
    expect(res.body.data.relabeledCount).toBe(0);
    expect(res.body.data.user.settings).toMatchObject({
      theme: "dark",
      weekStart: "sun",
      tzMode: "manual",
      tzid: "Asia/Dubai",
      currencyCode: "INR",
      locale: "en-IN",
    });
  });

  it("rejects bad currency, zone, locale, enums, unknown fields and empty bodies", async () => {
    const { headers } = await createSignedInUser();
    const bodies = [
      { currencyCode: "XXQ" },
      { tzid: "Mars/Base" },
      { locale: "not a locale!!" },
      { theme: "pink" },
      { weekStart: "tue" },
      { tzMode: "auto" },
      { fontSize: 12 },
      {},
    ];
    for (const body of bodies) {
      const res = await request(app).patch("/api/v1/me/settings").set(headers).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("relabels only this user's entries on a currency change and derives the locale", async () => {
    const me = await userWithData();
    const other = await userWithData();
    await addTx(me.userId, me.ledger.accounts.savings._id, me.ledger.categories.food._id, 24000);
    await addTx(me.userId, me.ledger.accounts.wallet._id, me.ledger.categories.food._id, 500);
    await addTx(
      other.userId,
      other.ledger.accounts.savings._id,
      other.ledger.categories.food._id,
      700,
    );

    const res = await request(app)
      .patch("/api/v1/me/settings")
      .set(me.headers)
      .send({ currencyCode: "usd" });
    expect(res.status).toBe(200);
    expect(res.body.data.relabeledCount).toBe(2);
    expect(res.body.data.user.settings.currencyCode).toBe("USD");
    expect(res.body.data.user.settings.locale).toBe("en-US");

    const mine = await Transaction.find({ userId: me.userId }).sort({ amountMinor: 1 });
    expect(mine.map((t) => [t.currencyCode, t.amountMinor])).toEqual([
      ["USD", 500],
      ["USD", 24000],
    ]);
    const theirs = await Transaction.find({ userId: other.userId });
    expect(theirs.map((t) => [t.currencyCode, t.amountMinor])).toEqual([["INR", 700]]);

    const same = await request(app)
      .patch("/api/v1/me/settings")
      .set(me.headers)
      .send({ currencyCode: "USD" });
    expect(same.body.data.relabeledCount).toBe(0);
  });

  it("keeps an explicit locale and falls back to en-US for unmapped currencies", async () => {
    const { headers } = await createSignedInUser();
    const explicit = await request(app)
      .patch("/api/v1/me/settings")
      .set(headers)
      .send({ currencyCode: "EUR", locale: "fr-FR" });
    expect(explicit.body.data.user.settings).toMatchObject({
      currencyCode: "EUR",
      locale: "fr-FR",
    });

    const fallback = await request(app)
      .patch("/api/v1/me/settings")
      .set(headers)
      .send({ currencyCode: "CAD" });
    expect(fallback.body.data.user.settings.locale).toBe("en-US");
  });

  it("requires a token", async () => {
    const res = await request(app).patch("/api/v1/me/settings").send({ theme: "dark" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/me/sessions", () => {
  it("lists active sessions newest first, marks the current one and hides others", async () => {
    const me = await createSignedInUser();
    const other = await createSignedInUser();
    const old = await Session.create({
      userId: me.userId,
      tokenHash: sha256(generateToken()),
      platform: "ios",
      userAgent: "Phone",
      lastUsedAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await Session.create({
      userId: me.userId,
      tokenHash: sha256(generateToken()),
      platform: "web",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await Session.create({
      userId: me.userId,
      tokenHash: sha256(generateToken()),
      platform: "web",
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).get("/api/v1/me/sessions").set(me.headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: String(old._id),
      platform: "ios",
      userAgent: "Phone",
      ipAddress: null,
      createdAt: expect.any(String),
      lastUsedAt: expect.any(String),
      current: false,
    });
    expect(res.body.data[1].current).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|previousTokenHash/);

    const theirs = await request(app).get("/api/v1/me/sessions").set(other.headers);
    expect(theirs.body.data).toHaveLength(1);
  });

  it("requires a token", async () => {
    expect((await request(app).get("/api/v1/me/sessions")).status).toBe(401);
  });
});

describe("DELETE /api/v1/me/sessions/:id", () => {
  it("revokes another session, whose token then stops working", async () => {
    const me = await createSignedInUser();
    const second = await createSignedInUserSession(me.userId);

    const res = await request(app)
      .delete(`/api/v1/me/sessions/${second.sessionId}`)
      .set(me.headers);
    expect(res.status).toBe(204);
    const doc = await Session.findById(second.sessionId);
    expect(doc.revokedReason).toBe("logout");

    const after = await request(app).get("/api/v1/me").set(second.headers);
    expect(after.status).toBe(401);
    const stillOk = await request(app).get("/api/v1/me").set(me.headers);
    expect(stillOk.status).toBe(200);

    const again = await request(app)
      .delete(`/api/v1/me/sessions/${second.sessionId}`)
      .set(me.headers);
    expect(again.status).toBe(404);
  });

  it("returns 404 for someone else's session and leaves it active", async () => {
    const me = await createSignedInUser();
    const other = await createSignedInUser();
    const theirs = await Session.findOne({ userId: other.userId });
    const res = await request(app).delete(`/api/v1/me/sessions/${theirs._id}`).set(me.headers);
    expect(res.status).toBe(404);
    expect((await Session.findById(theirs._id)).revokedAt).toBeUndefined();
  });

  it("rejects a bad id and a missing token", async () => {
    const me = await createSignedInUser();
    expect((await request(app).delete("/api/v1/me/sessions/abc").set(me.headers)).status).toBe(400);
    const id = new mongoose.Types.ObjectId();
    expect((await request(app).delete(`/api/v1/me/sessions/${id}`)).status).toBe(401);
  });
});

describe("DELETE /api/v1/me", () => {
  async function passwordUser() {
    const me = await userWithData({ passwordHash: await hashPassword(PASSWORD) });
    await addTx(me.userId, me.ledger.accounts.savings._id, me.ledger.categories.food._id, 100);
    return me;
  }

  it("rejects a wrong confirm word or unknown fields with 400", async () => {
    const me = await passwordUser();
    for (const body of [
      { confirm: "delete", password: PASSWORD },
      { password: PASSWORD },
      { confirm: "DELETE", x: 1 },
    ]) {
      const res = await request(app).delete("/api/v1/me").set(me.headers).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns 401 for a wrong or missing password and keeps the data", async () => {
    const me = await passwordUser();
    for (const body of [{ confirm: "DELETE", password: "wrong-password" }, { confirm: "DELETE" }]) {
      const res = await request(app).delete("/api/v1/me").set(me.headers).send(body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(await User.countDocuments({ _id: me.userId })).toBe(1);
    expect(await Transaction.countDocuments({ userId: me.userId })).toBe(1);
    expect(await Account.countDocuments({ userId: me.userId })).toBeGreaterThan(0);
  });

  it("deletes the user and all their data but leaves other users alone", async () => {
    const me = await passwordUser();
    const other = await userWithData();
    await addTx(
      other.userId,
      other.ledger.accounts.savings._id,
      other.ledger.categories.food._id,
      9,
    );

    const res = await request(app)
      .delete("/api/v1/me")
      .set(me.headers)
      .send({ confirm: "DELETE", password: PASSWORD });
    expect(res.status).toBe(204);

    expect(await User.countDocuments({ _id: me.userId })).toBe(0);
    expect(await Account.countDocuments({ userId: me.userId })).toBe(0);
    expect(await Transaction.countDocuments({ userId: me.userId })).toBe(0);
    expect(await Session.countDocuments({ userId: me.userId })).toBe(0);
    expect(await User.countDocuments({ _id: other.userId })).toBe(1);
    expect(await Account.countDocuments({ userId: other.userId })).toBeGreaterThan(0);
    expect(await Transaction.countDocuments({ userId: other.userId })).toBe(1);
    expect(await Session.countDocuments({ userId: other.userId })).toBe(1);
  });

  it("lets a Google-only account delete with confirm alone", async () => {
    const me = await userWithData({ googleSub: "google-sub-1" });
    const res = await request(app).delete("/api/v1/me").set(me.headers).send({ confirm: "DELETE" });
    expect(res.status).toBe(204);
    expect(await User.countDocuments({ _id: me.userId })).toBe(0);
    expect(await Account.countDocuments({ userId: me.userId })).toBe(0);
  });

  it("requires a token", async () => {
    const res = await request(app).delete("/api/v1/me").send({ confirm: "DELETE" });
    expect(res.status).toBe(401);
  });
});

async function createSignedInUserSession(userId) {
  const { signAccessToken } = await import("../../src/utils/jwt.js");
  const session = await Session.create({
    userId,
    tokenHash: sha256(generateToken()),
    platform: "android",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const token = signAccessToken({ userId: String(userId), sessionId: String(session._id) });
  return {
    sessionId: String(session._id),
    headers: { Authorization: `Bearer ${token}`, "X-Client-Platform": "android" },
  };
}

describe("DELETE /me limits and sweep", () => {
  it("allows 5 attempts per 15 minutes per user", async () => {
    const me = await createSignedInUser();
    const other = await createSignedInUser();
    const attempt = (user) => request(app).delete("/api/v1/me").set(user.headers).send({});
    for (let index = 0; index < 5; index += 1) expect((await attempt(me)).status).toBe(400);

    const blocked = await attempt(me);

    expect([blocked.status, blocked.body.error.code]).toEqual([429, "RATE_LIMITED"]);
    expect((await attempt(other)).status).toBe(400);
  });

  it("sweeps rows inserted by in-flight requests after the user row is gone", async () => {
    const me = await createSignedInUser();
    const ledger = await seedLedger(me.userId);
    const realDeleteOne = User.deleteOne.bind(User);
    const spy = vi.spyOn(User, "deleteOne").mockImplementationOnce((...args) => {
      const query = realDeleteOne(...args);
      // A request that was already running inserts a row right after the first pass.
      return query.then(async (result) => {
        await Account.create({
          userId: me.userId,
          name: "Late",
          nameKey: "late",
          type: "cash",
          icon: "cash",
          color: "c1",
        });
        return result;
      });
    });

    const counts = await deleteAllForUser(me.userId);

    spy.mockRestore();
    expect(counts.Account).toBe(Object.keys(ledger.accounts).length + 1);
    expect(await Account.countDocuments({ userId: me.userId })).toBe(0);
  });
});
