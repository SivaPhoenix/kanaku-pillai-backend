import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailToken } from "../../src/models/email-token.model.js";
import { Session } from "../../src/models/session.model.js";
import { User } from "../../src/models/user.model.js";
import { bearer, PASSWORD, signupNative } from "../helpers/auth.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser } from "../helpers/ledger.js";

// No email leaves the test run: the transport is replaced and each test reads the links out of the captured messages.
vi.mock("../../src/integrations/mail/mail-transport.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendMail: vi.fn().mockResolvedValue(undefined) };
});

const { sendMail } = await import("../../src/integrations/mail/mail-transport.js");
const { createApp } = await import("../../src/app.js");

const app = createApp();
const NEW_PASSWORD = "Fresh#Ledger9";
const native = { "X-Client-Platform": "android" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mailsSent(count) {
  await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(count));
  return sendMail.mock.calls.map(([message]) => message);
}

function tokenFrom(message, path) {
  const match = message.text.match(new RegExp(`http://localhost:5173${path}#token=([\\w-]+)`));
  expect(match, `no ${path} link in "${message.subject}"`).not.toBeNull();
  return match[1];
}

async function signupAndVerifyToken(overrides) {
  const session = await signupNative(app, overrides);
  const [mail] = await mailsSent(1);
  return { session, token: tokenFrom(mail, "/auth/verify-email") };
}

async function requestReset(email = "siva@example.com") {
  return request(app).post("/api/v1/auth/forgot-password").send({ email });
}

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await resetTestDb();
  sendMail.mockClear();
});

describe("verification email on signup", () => {
  it("sends one verification email with a fragment link and leaves the account unverified", async () => {
    const { session } = await signupAndVerifyToken();
    const [mail] = sendMail.mock.calls[0];

    expect(mail.to).toBe("siva@example.com");
    expect(mail.subject).toBe("Verify your email for Kanaku Pillai");
    expect(mail.html).toContain("Verify email");
    expect(session.user.emailVerified).toBe(false);

    const stored = await EmailToken.find().lean();
    expect(stored).toHaveLength(1);
    expect(stored[0].purpose).toBe("verify_email");
    // Only the digest is stored, never the token from the link.
    expect(mail.text).not.toContain(stored[0].tokenHash);
  });

  it("escapes the user's name in the HTML email", async () => {
    await signupNative(app, { name: "<b>Siva" });
    const [mail] = await mailsSent(1);
    expect(mail.html).toContain("Hi &lt;b&gt;Siva,");
    expect(mail.html).not.toContain("<b>Siva");
  });
});

describe("POST /api/v1/auth/verify-email", () => {
  it("verifies the email, and opening the same link again still succeeds", async () => {
    const { session, token } = await signupAndVerifyToken();

    const first = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ emailVerified: true });

    const me = await request(app).get("/api/v1/me").set(bearer(session.accessToken));
    expect(me.body.data.emailVerified).toBe(true);

    const again = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(again.status).toBe(200);
  });

  it("rejects an unknown or expired link with 400 INVALID_LINK", async () => {
    const { token } = await signupAndVerifyToken();

    const unknown = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ token: "x".repeat(43) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("INVALID_LINK");

    await EmailToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(expired.body.error.code).toBe("INVALID_LINK");
    expect((await User.findOne().lean()).emailVerifiedAt).toBeUndefined();
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/v1/auth/verify-email").send({ token: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/me/verify-email", () => {
  it("requires a token", async () => {
    expect((await request(app).post("/api/v1/me/verify-email")).status).toBe(401);
  });

  it("sends a fresh link once per cooldown, and earlier links keep working", async () => {
    const { session, token: oldToken } = await signupAndVerifyToken();
    // Straight to the collection: Mongoose timestamps refuse to change createdAt.
    await EmailToken.collection.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 120_000) } },
    );

    const res = await request(app).post("/api/v1/me/verify-email").set(bearer(session.accessToken));
    expect(res.status).toBe(202);
    const mails = await mailsSent(2);
    const newToken = tokenFrom(mails[1], "/auth/verify-email");

    // Within the cooldown a second tap sends nothing new.
    await request(app).post("/api/v1/me/verify-email").set(bearer(session.accessToken));
    await sleep(100);
    expect(sendMail).toHaveBeenCalledTimes(2);

    // Requesting a new link must not kill the old one, or anyone could keep a user's links dead.
    const old = await request(app).post("/api/v1/auth/verify-email").send({ token: oldToken });
    expect(old.status).toBe(200);
    const fresh = await request(app).post("/api/v1/auth/verify-email").send({ token: newToken });
    expect(fresh.status).toBe(200);
  });

  it("returns 409 EMAIL_ALREADY_VERIFIED once verified", async () => {
    const { session, token } = await signupAndVerifyToken();
    await request(app).post("/api/v1/auth/verify-email").send({ token });

    const res = await request(app).post("/api/v1/me/verify-email").set(bearer(session.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_VERIFIED");
  });
});

describe("POST /api/v1/auth/forgot-password", () => {
  it("answers 202 with no body for an unknown email and sends nothing", async () => {
    const res = await requestReset("nobody@example.com");
    expect(res.status).toBe(202);
    expect(res.text).toBe("");
    await sleep(150);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("answers the same way for a real account and emails a reset link", async () => {
    await signupAndVerifyToken();
    const res = await requestReset("  SIVA@example.com ");
    expect(res.status).toBe(202);
    expect(res.text).toBe("");

    const mails = await mailsSent(2);
    expect(mails[1].to).toBe("siva@example.com");
    expect(mails[1].subject).toBe("Reset your Kanaku Pillai password");
    tokenFrom(mails[1], "/auth/reset-password");
  });

  it("sends at most one reset email per cooldown", async () => {
    await signupAndVerifyToken();
    await requestReset();
    await mailsSent(2);
    await requestReset();
    await sleep(150);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("validates the email and rate-limits per IP and email", async () => {
    const bad = await request(app).post("/api/v1/auth/forgot-password").send({ email: "nope" });
    expect(bad.status).toBe(400);

    for (let i = 0; i < 5; i += 1) expect((await requestReset("x@example.com")).status).toBe(202);
    const limited = await requestReset("x@example.com");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("caps one IP at 20 requests an hour across different emails", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await requestReset(`user${i}@example.com`)).status).toBe(202);
    }
    expect((await requestReset("user99@example.com")).status).toBe(429);
  });
});

describe("password reset", () => {
  async function resetToken() {
    const { session } = await signupAndVerifyToken();
    await requestReset();
    const mails = await mailsSent(2);
    return { session, token: tokenFrom(mails[1], "/auth/reset-password") };
  }

  it("checks a link without using it up", async () => {
    const { token } = await resetToken();
    const check = () => request(app).post("/api/v1/auth/reset-password/check").send({ token });
    expect((await check()).status).toBe(204);
    expect((await check()).status).toBe(204);

    const bad = await request(app)
      .post("/api/v1/auth/reset-password/check")
      .send({ token: "y".repeat(43) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_LINK");
  });

  it("sets the new password, verifies the email, signs out everywhere and sends a notice", async () => {
    const { session, token } = await resetToken();

    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set(native)
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
    expect(await Session.countDocuments({ revokedReason: "password_reset" })).toBe(1);

    const login = (password) =>
      request(app)
        .post("/api/v1/auth/login")
        .set(native)
        .send({ email: "siva@example.com", password });
    expect((await login(PASSWORD)).status).toBe(401);
    const fresh = await login(NEW_PASSWORD);
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.user.emailVerified).toBe(true);

    const mails = await mailsSent(3);
    expect(mails[2].subject).toBe("Your Kanaku Pillai password was changed");
  });

  it("keeps an earlier link valid after a new request, and a reset ends every other link", async () => {
    const { token: first } = await resetToken();
    await EmailToken.collection.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 120_000) } },
    );
    await requestReset();
    const mails = await mailsSent(3);
    const second = tokenFrom(mails[2], "/auth/reset-password");

    const check = (token) => request(app).post("/api/v1/auth/reset-password/check").send({ token });
    expect((await check(first)).status).toBe(204);

    const reset = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: second, password: NEW_PASSWORD });
    expect(reset.status).toBe(204);
    expect((await check(first)).body.error.code).toBe("INVALID_LINK");
  });

  it("works only once and not after expiry", async () => {
    const { token } = await resetToken();
    const reset = () =>
      request(app).post("/api/v1/auth/reset-password").send({ token, password: NEW_PASSWORD });

    expect((await reset()).status).toBe(204);
    const reused = await reset();
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe("INVALID_LINK");
  });

  it("rejects an expired link and keeps the old password", async () => {
    const { token } = await resetToken();
    await EmailToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(res.body.error.code).toBe("INVALID_LINK");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set(native)
      .send({ email: "siva@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("applies the password rules", async () => {
    const { token } = await resetToken();
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("gives a Google-only account its first password", async () => {
    await User.create({ name: "G User", email: "g@example.com", googleSub: "sub-1" });
    await requestReset("g@example.com");
    const [mail] = await mailsSent(1);
    const token = tokenFrom(mail, "/auth/reset-password");

    await request(app).post("/api/v1/auth/reset-password").send({ token, password: NEW_PASSWORD });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set(native)
      .send({ email: "g@example.com", password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.authMethods).toEqual(["password", "google"]);
  });
});

describe("POST /api/v1/auth/change-password", () => {
  const change = (accessToken, body) =>
    request(app).post("/api/v1/auth/change-password").set(bearer(accessToken)).send(body);
  const login = (password) =>
    request(app)
      .post("/api/v1/auth/login")
      .set(native)
      .send({ email: "siva@example.com", password });

  it("changes the password, keeps this device, signs out the others and sends a notice", async () => {
    const first = await signupNative(app);
    const second = (await login(PASSWORD)).body.data;
    await mailsSent(1);

    const res = await change(first.accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(204);

    // This device keeps working; the other one is signed out.
    expect((await request(app).get("/api/v1/me").set(bearer(first.accessToken))).status).toBe(200);
    expect((await request(app).get("/api/v1/me").set(bearer(second.accessToken))).status).toBe(401);
    expect(await Session.countDocuments({ revokedReason: "password_change" })).toBe(1);

    expect((await login(PASSWORD)).status).toBe(401);
    const fresh = await login(NEW_PASSWORD);
    expect(fresh.status).toBe(200);
    // A change proves nothing about the inbox, so the email stays unverified.
    expect(fresh.body.data.user.emailVerified).toBe(false);

    const mails = await mailsSent(2);
    expect(mails[1].subject).toBe("Your Kanaku Pillai password was changed");
    expect(mails[1].text).toContain("every other device was signed out");
  });

  it("rejects a wrong current password with 401 INVALID_CREDENTIALS and keeps the old one", async () => {
    const { accessToken } = await signupNative(app);
    const res = await change(accessToken, {
      currentPassword: "Wrong#123",
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it("rejects the same password, weak passwords and unknown fields", async () => {
    const { accessToken } = await signupNative(app);
    const same = await change(accessToken, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error.details[0].field).toBe("body.newPassword");

    const weak = await change(accessToken, { currentPassword: PASSWORD, newPassword: "short" });
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    const extra = await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      x: 1,
    });
    expect(extra.status).toBe(400);
  });

  it("returns 409 PASSWORD_NOT_SET for a Google-only account", async () => {
    const { headers } = await createSignedInUser({ googleSub: "sub-2" });
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set(headers)
      .send({ currentPassword: "Any#1234", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PASSWORD_NOT_SET");
  });

  it("requires a signed-in user and rate-limits per user", async () => {
    const anonymous = await request(app)
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(anonymous.status).toBe(401);

    const { accessToken } = await signupNative(app);
    for (let i = 0; i < 5; i += 1) {
      await change(accessToken, { currentPassword: "Wrong#123", newPassword: NEW_PASSWORD });
    }
    const limited = await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(limited.status).toBe(429);
  });
});

describe("account deletion", () => {
  it("removes the user's email tokens", async () => {
    const { session } = await signupAndVerifyToken();
    const res = await request(app)
      .delete("/api/v1/me")
      .set(bearer(session.accessToken))
      .send({ confirm: "DELETE", password: PASSWORD });
    expect(res.status).toBe(204);
    expect(await EmailToken.countDocuments()).toBe(0);
  });
});
