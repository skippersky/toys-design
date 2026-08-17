import { describe, expect, it, vi } from "vitest";

import {
  AnonymousSessionError,
  ensureAnonymousSession,
  type AnonymousAuthApi,
} from "@/lib/supabase/anonymous-auth";

describe("anonymous Supabase session", () => {
  it("reuses an existing session", async () => {
    const auth: AnonymousAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "existing-user" } } },
        error: null,
      }),
      signInAnonymously: vi.fn(),
    };

    await expect(ensureAnonymousSession(auth)).resolves.toEqual({
      userId: "existing-user",
      created: false,
    });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates an anonymous session when none exists", async () => {
    const auth: AnonymousAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
      signInAnonymously: vi.fn().mockResolvedValue({
        data: { user: { id: "anonymous-user" } },
        error: null,
      }),
    };

    await expect(ensureAnonymousSession(auth)).resolves.toEqual({
      userId: "anonymous-user",
      created: true,
    });
  });

  it("returns actionable guidance when anonymous auth is disabled", async () => {
    const auth: AnonymousAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
      signInAnonymously: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Anonymous sign-ins are disabled" },
      }),
    };

    try {
      await ensureAnonymousSession(auth);
      throw new Error("Expected anonymous sign-in to fail");
    } catch (caught: unknown) {
      expect(caught).toBeInstanceOf(AnonymousSessionError);
      if (!(caught instanceof AnonymousSessionError)) {
        throw caught;
      }
      expect(caught.reason).toBe("anonymous-sign-in");
      expect(caught.message).toContain("Providers → Anonymous 已启用");
    }
  });
});
