import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { startTestDb, stopTestDb } from "../helpers/db.js";

const app = createApp();

describe("health probes", () => {
  afterAll(stopTestDb);

  it("/health is 200 even without a database (liveness)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });

  it("/ready is 503 while the database is not connected", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ data: { status: "unavailable", checks: { database: "down" } } });
  });

  it("/ready is 200 once the database is connected", async () => {
    await startTestDb();
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok", checks: { database: "up" } } });
  });
});
