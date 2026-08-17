import { describe, expect, it } from "vitest";

import {
  parseGenerationSseBlock,
  readGenerationHttpError,
} from "@/hooks/use-statue-generation";

describe("generation SSE parser", () => {
  it("parses typed progress events", () => {
    expect(
      parseGenerationSseBlock(
        'event: progress\r\ndata: {"task_id":"task-1","prompt_id":"prompt-1","status":"running","step":3,"total":20}\r\n',
      ),
    ).toEqual({
      event: "progress",
      data: {
        task_id: "task-1",
        prompt_id: "prompt-1",
        status: "running",
        step: 3,
        total: 20,
      },
    });
  });

  it("rejects malformed completion payloads", () => {
    expect(
      parseGenerationSseBlock(
        'event: complete\ndata: {"asset_id":"asset-1"}\n',
      ),
    ).toBeNull();
    expect(
      parseGenerationSseBlock("event: progress\ndata: not-json\n"),
    ).toBeNull();
  });

  it("preserves the 402 credit error contract", async () => {
    const error = await readGenerationHttpError(
      new Response(
        JSON.stringify({
          code: "insufficient_credits",
          message: "额度不足，请充值后重试。",
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(error).toEqual({
      code: "insufficient_credits",
      message: "额度不足，请充值后重试。",
    });
  });
});
