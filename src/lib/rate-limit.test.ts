import { beforeEach, describe, expect, it } from "vitest";

import { clearRateLimitsForTests, consumeRateLimit } from "@/lib/rate-limit";

describe("consumeRateLimit", () => {
  beforeEach(clearRateLimitsForTests);

  it("blocks requests over the limit until the fixed window resets", () => {
    expect(consumeRateLimit("user", 2, 10_000, 0).allowed).toBe(true);
    expect(consumeRateLimit("user", 2, 10_000, 1).allowed).toBe(true);
    expect(consumeRateLimit("user", 2, 10_000, 2)).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
    expect(consumeRateLimit("user", 2, 10_000, 10_000).allowed).toBe(true);
  });
});
