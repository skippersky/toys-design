import { beforeEach, describe, expect, it } from "vitest";

import { useGenerationStore } from "@/store/generation-store";
import type { StatueGenerationInput } from "@/types/generation";

const request: StatueGenerationInput = {
  projectId: "11111111-1111-4111-8111-111111111111",
  editorAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  templateId: "product-render",
  prompt: "studio statue",
  width: 512,
  height: 512,
  steps: 4,
  cfg: 2,
};

describe("generation store", () => {
  beforeEach(() => {
    useGenerationStore.getState().reset();
  });

  it("does not pause when there is no active generation", () => {
    useGenerationStore.getState().setPaused();

    expect(useGenerationStore.getState().status).toBe("idle");
  });

  it("pauses and resumes an active generation", () => {
    useGenerationStore.getState().setQueued(request);
    useGenerationStore.getState().setPaused();
    expect(useGenerationStore.getState().status).toBe("paused");

    useGenerationStore.getState().resume("queued");
    expect(useGenerationStore.getState().status).toBe("queued");
  });

  it("ignores resume when the task is no longer paused", () => {
    useGenerationStore.getState().setError("failed", "test_error");
    useGenerationStore.getState().resume("running");

    expect(useGenerationStore.getState().status).toBe("error");
  });
});
