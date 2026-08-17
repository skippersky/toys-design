import { describe, expect, it, vi } from "vitest";

import { writeServerCookies } from "@/lib/supabase/server";

const cookies = [
  {
    name: "sb-access-token",
    value: "access",
    options: { path: "/", httpOnly: true },
  },
  {
    name: "sb-refresh-token",
    value: "refresh",
    options: { path: "/", httpOnly: true },
  },
] as const;

describe("writeServerCookies", () => {
  it("persists refreshed cookies in writable request contexts", () => {
    const setCookie = vi.fn();

    writeServerCookies(cookies, setCookie);

    expect(setCookie).toHaveBeenCalledTimes(2);
    expect(setCookie).toHaveBeenCalledWith(
      "sb-access-token",
      "access",
      cookies[0].options,
    );
  });

  it("ignores cookie writes in read-only Server Components", () => {
    const setCookie = vi.fn(() => {
      throw new Error("Cookies can only be modified in a Route Handler.");
    });

    expect(() => {
      writeServerCookies(cookies, setCookie);
    }).not.toThrow();
  });
});
