import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERROR_CODES } from "../../src/constants/error-codes.js";
import { validate } from "../../src/middleware/validate.js";
import { ApiError } from "../../src/utils/api-error.js";

const schemas = {
  params: z.object({ id: z.string().length(24) }).strict(),
  query: z.object({ limit: z.coerce.number().int().max(100).default(50) }).strict(),
  body: z.object({ amountMinor: z.number().int().positive() }).strict(),
};

function run(req) {
  const next = vi.fn();
  validate(schemas)(req, {}, next);
  return next;
}

describe("validate middleware", () => {
  it("puts parsed values on req.validated and calls next without an error", () => {
    const req = {
      params: { id: "a".repeat(24) },
      query: { limit: "20" },
      body: { amountMinor: 24000 },
    };
    const next = run(req);
    expect(next).toHaveBeenCalledWith();
    expect(req.validated).toEqual({
      params: { id: "a".repeat(24) },
      query: { limit: 20 },
      body: { amountMinor: 24000 },
    });
  });

  it("applies schema defaults when the part is missing", () => {
    const req = { params: { id: "a".repeat(24) }, body: { amountMinor: 1 } };
    run(req);
    expect(req.validated.query).toEqual({ limit: 50 });
  });

  it("collects every issue across parts into one 400 error with field paths", () => {
    const next = run({
      params: { id: "short" },
      query: { limit: "500" },
      body: { amountMinor: 1.5, extra: true },
    });
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    const fields = error.details.map((detail) => detail.field);
    expect(fields).toEqual(
      expect.arrayContaining(["params.id", "query.limit", "body.amountMinor"]),
    );
    expect(error.details.some((detail) => /extra/.test(detail.message))).toBe(true);
  });
});
