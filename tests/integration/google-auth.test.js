import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { User } from "../../src/models/user.model.js";
import { bearer, PASSWORD, signupNative } from "../helpers/auth.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";

// Google is never called: the verifier is replaced, and each test decides what the "verified" token contains.
vi.mock("../../src/integrations/google/id-token-verifier.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyGoogleIdToken: vi.fn() };
});

const { verifyGoogleIdToken, GoogleTokenError } =
  await import("../../src/integrations/google/id-token-verifier.js");
const { createApp } = await import("../../src/app.js");

const app = createApp();
const ID_TOKEN = "g".repeat(200);

const profile = (overrides = {}) => ({
  sub: "google-sub-123",
  email: "siva@example.com",
  emailVerified: true,
  name: "Siva Google",
  picture: "https://lh3.googleusercontent.com/a/photo",
  ...overrides,
});

function googleSignIn(platform = "android") {
  return request(app)
    .post("/api/v1/auth/google")
    .set("X-Client-Platform", platform)
    .send({ idToken: ID_TOKEN });
}

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await resetTestDb();
  verifyGoogleIdToken.mockReset();
});

describe("POST /api/v1/auth/google", () => {
  it("creates a new Google-only account on first sign-in", async () => {
    verifyGoogleIdToken.mockResolvedValue(profile());
    const res = await googleSignIn();

    expect(res.status).toBe(201);
    expect(verifyGoogleIdToken).toHaveBeenCalledWith(ID_TOKEN);
    const { user, isNewUser, refreshToken } = res.body.data;
    expect(isNewUser).toBe(true);
    expect(refreshToken).toEqual(expect.any(String));
    expect(user).toMatchObject({
      name: "Siva Google",
      email: "siva@example.com",
      avatarUrl: "https://lh3.googleusercontent.com/a/photo",
      emailVerified: true,
      authMethods: ["google"],
      setupComplete: false,
    });
    expect(JSON.stringify(res.body)).not.toContain("google-sub-123");
  });

  it("signs a returning user in by Google id, even if their Google email changed", async () => {
    verifyGoogleIdToken.mockResolvedValue(profile());
    const first = await googleSignIn();
    verifyGoogleIdToken.mockResolvedValue(profile({ email: "renamed@example.com" }));
    const second = await googleSignIn();

    expect(second.status).toBe(200);
    expect(second.body.data.isNewUser).toBe(false);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect(await User.countDocuments()).toBe(1);
  });

  it("links Google to a verified password account and keeps the password", async () => {
    const { user } = await signupNative(app);
    await User.updateOne({ _id: user.id }, { $set: { emailVerifiedAt: new Date() } });
    verifyGoogleIdToken.mockResolvedValue(profile());

    const res = await googleSignIn();
    expect(res.status).toBe(200);
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.authMethods).toEqual(["password", "google"]);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "siva@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("takes over an unverified password account: password removed, old sessions ended", async () => {
    const { user, accessToken, refreshToken } = await signupNative(app);
    verifyGoogleIdToken.mockResolvedValue(profile());

    const res = await googleSignIn();
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.authMethods).toEqual(["google"]);
    expect(res.body.data.user.emailVerified).toBe(true);

    const oldMe = await request(app).get("/api/v1/me").set(bearer(accessToken));
    expect(oldMe.status).toBe(401);
    const oldRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "android")
      .send({ refreshToken });
    expect(oldRefresh.status).toBe(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "siva@example.com", password: PASSWORD });
    expect(login.status).toBe(401);

    const newMe = await request(app).get("/api/v1/me").set(bearer(res.body.data.accessToken));
    expect(newMe.status).toBe(200);
  });

  it("refuses a Google account whose email is not verified", async () => {
    verifyGoogleIdToken.mockResolvedValue(profile({ emailVerified: false }));
    const res = await googleSignIn();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
    expect(await User.countDocuments()).toBe(0);
  });

  it("returns GOOGLE_TOKEN_INVALID when verification fails", async () => {
    verifyGoogleIdToken.mockRejectedValue(new GoogleTokenError("Wrong recipient"));
    const res = await googleSignIn();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GOOGLE_TOKEN_INVALID");
    expect(res.body.error.message).not.toMatch(/recipient/);
  });

  it("validates the request body", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: "short" });
    expect(res.status).toBe(400);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("sets the web refresh cookie for browser sign-ins", async () => {
    verifyGoogleIdToken.mockResolvedValue(profile());
    const res = await googleSignIn("web");
    expect(res.status).toBe(201);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.headers["set-cookie"].some((c) => c.startsWith("kp_refresh="))).toBe(true);
  });
});
