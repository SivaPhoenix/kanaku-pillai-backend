import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../../src/config/env.js";

const base = {
  MONGODB_URI: "mongodb://localhost:27017/kp?replicaSet=rs0",
  JWT_ACCESS_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("requires a JWT secret of at least 32 characters", () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: undefined })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("validates Google client IDs and requires them in production", () => {
    expect(
      loadEnv({
        ...base,
        GOOGLE_CLIENT_IDS: "a-1.apps.googleusercontent.com, b.apps.googleusercontent.com",
      }).GOOGLE_CLIENT_IDS,
    ).toEqual(["a-1.apps.googleusercontent.com", "b.apps.googleusercontent.com"]);
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_IDS: "my-client-secret" })).toThrow(
      /GOOGLE_CLIENT_IDS/,
    );
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(
      /GOOGLE_CLIENT_IDS: is required in production/,
    );
  });

  it("applies defaults when only the required values are given", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 4000,
      LOG_LEVEL: "info",
      TRUST_PROXY: 0,
      JSON_BODY_LIMIT: "100kb",
      SHUTDOWN_TIMEOUT_MS: 10000,
      DNS_SERVERS: [],
    });
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadEnv(base))).toBe(true);
  });

  it("coerces numbers", () => {
    const env = loadEnv({ ...base, PORT: "8080", TRUST_PROXY: "1" });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it("accepts Atlas mongodb+srv URIs and rejects other schemes", () => {
    expect(
      loadEnv({ ...base, MONGODB_URI: "mongodb+srv://u:p@cluster0.example.mongodb.net/kp" })
        .MONGODB_URI,
    ).toMatch(/^mongodb\+srv:/);
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({ ...base, MONGODB_URI: "postgres://x" })).toThrow(/MONGODB_URI/);
  });

  it("splits optional DNS servers and rejects non-IP entries", () => {
    expect(loadEnv({ ...base, DNS_SERVERS: " 10.16.1.25 , 8.8.8.8 ," }).DNS_SERVERS).toEqual([
      "10.16.1.25",
      "8.8.8.8",
    ]);
    expect(() => loadEnv({ ...base, DNS_SERVERS: "dns.google" })).toThrow(/DNS_SERVERS/);
  });

  it("lists every problem at once", () => {
    try {
      loadEnv({ PORT: "abc", NODE_ENV: "staging" });
      expect.unreachable();
    } catch (error) {
      expect(error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});
