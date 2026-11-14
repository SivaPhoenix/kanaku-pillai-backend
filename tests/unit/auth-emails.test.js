import { describe, expect, it } from "vitest";
import {
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "../../src/integrations/mail/templates/auth-emails.js";
import { maskEmail } from "../../src/integrations/mail/mail-transport.js";

const url = "https://app.example.com/auth/reset-password#token=abc_DEF-123";

describe("auth email templates", () => {
  it.each([
    ["verify", verifyEmailMessage({ name: "Siva Sriram", url, ttlHours: 24 }), "Verify email"],
    ["reset", resetPasswordMessage({ name: "Siva Sriram", url, ttlMinutes: 30 }), "Reset password"],
    ["changed", passwordChangedMessage({ name: "Siva Sriram", url }), "Reset password"],
  ])("%s has a subject, an HTML button and a plain-text link", (_kind, message, label) => {
    expect(message.subject).toMatch(/Kanaku Pillai/);
    expect(message.html).toContain(`href="${url}"`);
    expect(message.html).toContain(label);
    expect(message.html).toContain("Hi Siva,");
    expect(message.text).toContain(url);
    expect(message.text).toContain("Hi Siva,");
  });

  it("escapes HTML in the name and falls back when it is blank", () => {
    const message = resetPasswordMessage({ name: '"><img src=x>', url, ttlMinutes: 30 });
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&quot;&gt;&lt;img");
    expect(verifyEmailMessage({ name: "  ", url, ttlHours: 24 }).text).toContain("Hi there,");
    for (const name of ["http://evil.example", "evil.example now", "a@b.co"]) {
      expect(verifyEmailMessage({ name, url, ttlHours: 24 }).text).toContain("Hi there,");
    }
  });

  it("states the expiry", () => {
    expect(verifyEmailMessage({ name: "A", url, ttlHours: 24 }).text).toContain("24 hours");
    expect(resetPasswordMessage({ name: "A", url, ttlMinutes: 30 }).text).toContain("30 minutes");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("siva@example.com")).toBe("s•••@example.com");
  });
});
