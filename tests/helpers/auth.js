import request from "supertest";

export const PASSWORD = "Ledger#2026";

// Signs up through the real endpoint as a native client, so the refresh token comes back in the body.
export async function signupNative(app, overrides = {}) {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .set("X-Client-Platform", "android")
    .send({ name: "Siva", email: "siva@example.com", password: PASSWORD, ...overrides });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export function bearer(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

export function refreshCookie(res) {
  return (res.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith("kp_refresh="));
}
