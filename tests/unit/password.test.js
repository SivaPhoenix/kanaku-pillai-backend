import { describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../../src/utils/password.js";

describe("password hashing", () => {
  it("hashes with argon2id and verifies only the right password", async () => {
    const hash = await hashPassword("Ledger#2026");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "Ledger#2026")).toBe(true);
    expect(await verifyPassword(hash, "ledger#2026")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats a malformed stored hash as a failed match instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("always fails the dummy check", async () => {
    expect(await verifyAgainstDummy("Ledger#2026")).toBe(false);
  });
});
