import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { User } from "../../src/models/user.model.js";
import { bearer, PASSWORD, refreshCookie, signupNative } from "../helpers/auth.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

describe("POST /api/v1/auth/signup", () => {
  it("creates the account and returns the user, an access token and a web refresh cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ name: "  Siva  ", email: "Siva@Example.com", password: PASSWORD });

    expect(res.status).toBe(201);
    const { user, accessToken, accessTokenExpiresIn, isNewUser, refreshToken } = res.body.data;
    expect(user).toEqual({
      id: expect.any(String),
      name: "Siva",
      email: "siva@example.com",
      avatarUrl: null,
      emailVerified: false,
      authMethods: ["password"],
      settings: {
        currencyCode: "INR",
        locale: "en-IN",
        tzMode: "device",
        tzid: "Asia/Kolkata",
        theme: "system",
        weekStart: "mon",
      },
      setupComplete: false,
      createdAt: expect.any(String),
    });
    expect(accessToken).toEqual(expect.any(String));
    expect(accessTokenExpiresIn).toBe(900);
    expect(isNewUser).toBe(true);
    expect(refreshToken).toBeUndefined();

    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Expires=/);
  });

  it("stores only an argon2id hash of the password", async () => {
    await signupNative(app);
    const stored = await User.findOne({ email: "siva@example.com" }).select("+passwordHash").lean();
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it("returns the refresh token in the body for native clients and sets no cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .set("X-Client-Platform", "ios")
      .send({ name: "Siva", email: "siva@example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.refreshTokenExpiresAt).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeUndefined();
  });

  it("rejects an email that already has an account, ignoring case", async () => {
    await signupNative(app);
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ name: "Other", email: "SIVA@example.com", password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("validates name, email, password rules and unknown fields", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ name: "", email: "not-an-email", password: "password", admin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((detail) => detail.field);
    expect(fields).toEqual(expect.arrayContaining(["body.name", "body.email", "body.password"]));
    expect(res.body.error.details.some((detail) => /admin/.test(detail.message))).toBe(true);
  });

  it("rejects an unknown client platform header", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .set("X-Client-Platform", "desktop")
      .send({ name: "Siva", email: "siva@example.com", password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("headers.x-client-platform");
  });
});

describe("POST /api/v1/auth/login", () => {
  beforeEach(() => signupNative(app));

  it("signs in with the right password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "SIVA@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("siva@example.com");
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.isNewUser).toBeUndefined();
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "siva@example.com", password: "Wrong#2026" });
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(res.body.error.message).toBe("Email or password is incorrect");
    }
  });

  it("issues a browser-session cookie when keep me signed in is off", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "siva@example.com", password: PASSWORD, keepSignedIn: false });
    expect(res.status).toBe(200);
    expect(refreshCookie(res)).not.toMatch(/Expires=/);
  });

  it("rate limits repeated attempts for the same email", async () => {
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "siva@example.com", password: "Wrong#2026" });
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    expect(last.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("GET /api/v1/me", () => {
  it("returns the signed-in user", async () => {
    const { accessToken, user } = await signupNative(app);
    const res = await request(app).get("/api/v1/me").set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(user);
  });

  it("requires a bearer token", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects forged, unsigned and expired tokens", async () => {
    const { user } = await signupNative(app);
    const sid = new mongoose.Types.ObjectId().toString();
    const forged = jwt.sign({ sid }, "some-other-secret-that-is-long-enough!!", {
      subject: user.id,
      issuer: "kanaku-pillai",
      audience: "kanaku-pillai-api",
    });
    const unsigned = jwt.sign({ sid }, null, { algorithm: "none", subject: user.id });
    const expired = jwt.sign({ sid }, process.env.JWT_ACCESS_SECRET, {
      subject: user.id,
      issuer: "kanaku-pillai",
      audience: "kanaku-pillai-api",
      expiresIn: -10,
    });

    for (const token of [forged, unsigned, "not-a-jwt"]) {
      const res = await request(app).get("/api/v1/me").set(bearer(token));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
    const res = await request(app).get("/api/v1/me").set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a validly signed token whose session does not exist", async () => {
    const { user } = await signupNative(app);
    const token = jwt.sign(
      { sid: new mongoose.Types.ObjectId().toString() },
      process.env.JWT_ACCESS_SECRET,
      { subject: user.id, issuer: "kanaku-pillai", audience: "kanaku-pillai-api" },
    );
    const res = await request(app).get("/api/v1/me").set(bearer(token));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the native refresh token and invalidates the old one", async () => {
    const { refreshToken } = await signupNative(app);
    const first = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(refreshToken);

    const me = await request(app).get("/api/v1/me").set(bearer(first.body.data.accessToken));
    expect(me.status).toBe(200);
  });

  it("revokes the session when an already-used refresh token is replayed", async () => {
    const { refreshToken: original } = await signupNative(app);
    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken: original });
    const { refreshToken: current, accessToken } = rotated.body.data;

    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken: original });
    expect(replay.status).toBe(401);

    // The legitimate holder's newer tokens stop working too, so a thief cannot keep the session.
    const afterReplay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken: current });
    expect(afterReplay.status).toBe(401);
    const me = await request(app).get("/api/v1/me").set(bearer(accessToken));
    expect(me.status).toBe(401);
  });

  it("refreshes a web session from the cookie alone", async () => {
    const agent = request.agent(app);
    const signup = await agent
      .post("/api/v1/auth/signup")
      .send({ name: "Siva", email: "siva@example.com", password: PASSWORD });
    const firstCookie = refreshCookie(signup);

    const res = await agent.post("/api/v1/auth/refresh");
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(refreshCookie(res)).not.toBe(firstCookie);
  });

  it("returns 401 and clears the cookie when there is no refresh token", async () => {
    const res = await request(app).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("ends the native session: refresh and access tokens stop working", async () => {
    const { refreshToken, accessToken } = await signupNative(app);
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("X-Client-Platform", "android")
      .send({ refreshToken });
    expect(res.status).toBe(204);

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken });
    expect(refreshed.status).toBe(401);
    const me = await request(app).get("/api/v1/me").set(bearer(accessToken));
    expect(me.status).toBe(401);
  });

  it("clears the web cookie and succeeds even without a session", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
