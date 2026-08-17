import { describe, expect, it, vi } from "vitest";

import {
  AnonymousSessionRequestError,
  ensureAnonymousSessionThroughServer,
} from "@/lib/supabase/anonymous-session-client";

describe("server-backed anonymous session", () => {
  it("returns a server-created session", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ userId: "anonymous-user", created: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(ensureAnonymousSessionThroughServer(fetcher)).resolves.toEqual(
      { userId: "anonymous-user", created: true },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/anonymous-session",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("shares one request across concurrent React initializations", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ userId: "shared-user", created: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const first = ensureAnonymousSessionThroughServer(fetcher);
    const second = ensureAnonymousSessionThroughServer(fetcher);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { userId: "shared-user", created: true },
      { userId: "shared-user", created: true },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves an actionable server error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: "Anonymous sign-ins are disabled" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      );

    await expect(
      ensureAnonymousSessionThroughServer(fetcher),
    ).rejects.toMatchObject({
      reason: "response",
      message: "Anonymous sign-ins are disabled",
    });
  });

  it("aborts a request that never settles", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const request = ensureAnonymousSessionThroughServer(fetcher, 25);
    const expectation = expect(request).rejects.toEqual(
      expect.objectContaining<Partial<AnonymousSessionRequestError>>({
        reason: "timeout",
      }),
    );

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    vi.useRealTimers();
  });
});
