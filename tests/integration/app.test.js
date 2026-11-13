import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const app = createApp();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request id", () => {
  it("generates a UUID when none is sent", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("keeps a caller-supplied UUID", async () => {
    const id = "3f1c2a4e-9b7d-4c1e-8f2a-6d5b4c3a2e1f";
    const res = await request(app).get("/health").set("X-Request-Id", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });

  it("replaces a caller-supplied value that is not a UUID", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "<script>");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });
});

describe("error envelope", () => {
  it("returns 404 NOT_FOUND with the request id for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route GET /api/v1/does-not-exist not found",
        requestId: res.headers["x-request-id"],
      },
    });
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await request(app)
      .post("/api/v1/anything")
      .set("Content-Type", "application/json")
      .send('{"amountMinor": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE above the body limit", async () => {
    const res = await request(app)
      .post("/api/v1/anything")
      .send({ note: "x".repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("HTTP hardening", () => {
  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("marks API responses as not cacheable", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("allows any origin, without credentials", async () => {
    for (const origin of ["http://localhost:5173", "https://anything.example"]) {
      const res = await request(app).get("/health").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });

  it("answers CORS preflight for the API headers", async () => {
    const res = await request(app)
      .options("/api/v1/transactions")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization, Idempotency-Key");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toMatch(/Idempotency-Key/);
  });
});
