import { describe, expect, it, vi } from "vitest";

import {
  refreshSessionWhenExpiring,
  type RefreshableAuthApi,
} from "@/lib/supabase/fresh-session";

describe("long-running Supabase session refresh", () => {
  it("keeps a session with enough remaining lifetime", async () => {
    const auth: RefreshableAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { expires_at: 1_600 } },
        error: null,
      }),
      refreshSession: vi.fn(),
    };

    await expect(refreshSessionWhenExpiring(auth, 300, 1_000)).resolves.toBe(
      false,
    );
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes a session that could expire during generation", async () => {
    const auth: RefreshableAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { expires_at: 1_100 } },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { expires_at: 4_600 } },
        error: null,
      }),
    };

    await expect(refreshSessionWhenExpiring(auth, 300, 1_000)).resolves.toBe(
      true,
    );
  });

  it("rejects a failed refresh", async () => {
    const auth: RefreshableAuthApi = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { expires_at: 1_100 } },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: "refresh token expired" },
      }),
    };

    await expect(refreshSessionWhenExpiring(auth, 300, 1_000)).rejects.toThrow(
      "refresh token expired",
    );
  });
});
