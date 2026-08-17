import { describe, expect, it, vi } from "vitest";

import {
  buildComfyUIWorkflow,
  composePrompt,
  createGenerationSeed,
  parseGenerationInput,
  PROMPT_TEMPLATES,
} from "@/lib/ai-generation";
import type { StatueGenerationInput } from "@/types/generation";

const input: StatueGenerationInput = {
  projectId: "11111111-1111-4111-8111-111111111111",
  editorAssetId: "22222222-2222-4222-8222-222222222222",
  templateId: "product-render",
  prompt: "a translucent resin robot",
  width: 384,
  height: 384,
  steps: 8,
  cfg: 2,
  seed: 42,
};

describe("AI generation contract", () => {
  it("exposes three prompt presets and validates bounded parameters", () => {
    expect(PROMPT_TEMPLATES).toHaveLength(3);
    expect(parseGenerationInput(input)).toEqual(input);
    expect(parseGenerationInput({ ...input, steps: 31 })).toBeNull();
    expect(parseGenerationInput({ ...input, width: 1000 })).toBeNull();
  });

  it("builds a standard text-to-image ComfyUI workflow", () => {
    const workflow = buildComfyUIWorkflow({
      input,
      checkpointName: "sdxl.safetensors",
      seed: 42,
      taskId: "task-1",
      samplerName: "lcm",
      scheduler: "sgm_uniform",
    });

    expect(workflow["1"].class_type).toBe("CheckpointLoaderSimple");
    expect(workflow["4"].class_type).toBe("EmptyLatentImage");
    expect(workflow["6"].inputs).toMatchObject({
      seed: 42,
      steps: 8,
      cfg: 2,
      denoise: 1,
      sampler_name: "lcm",
      scheduler: "sgm_uniform",
    });
  });

  it("switches to VAE-encoded img2img with the template denoise preset", () => {
    const workflow = buildComfyUIWorkflow({
      input: {
        ...input,
        templateId: "style-transfer",
        sourceImageUrl: "https://example.com/source.png",
      },
      checkpointName: "sdxl.safetensors",
      seed: 42,
      taskId: "task-2",
      inputImageName: "input/source.png",
    });

    expect(workflow["4"].class_type).toBe("LoadImage");
    expect(workflow["5"].class_type).toBe("ImageScale");
    expect(workflow["9"].class_type).toBe("VAEEncode");
    expect(workflow["5"].inputs).toMatchObject({
      width: 384,
      height: 384,
    });
    expect(workflow["6"].inputs.denoise).toBe(0.65);
  });

  it("uses a custom negative prompt and produces bounded random seeds", () => {
    expect(
      composePrompt({ ...input, negativePrompt: "custom negative" }).negative,
    ).toBe("custom negative");
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint32Array) => {
        values[0] = 4_294_967_295;
        return values;
      },
    });
    expect(createGenerationSeed()).toBe(2_147_483_647);
    vi.unstubAllGlobals();
  });
});
