import { describe, expect, it } from "vitest";

import { resolveAiRuntimeConfig } from "@/lib/ai-runtime-config";

describe("AI runtime configuration", () => {
  it("uses high-performance SDXL deployment values", () => {
    const config = resolveAiRuntimeConfig({
      profile: "cuda-sdxl-high",
      defaultSteps: "25",
      defaultCfg: "7",
      squareWidth: "1024",
      squareHeight: "1024",
      landscapeWidth: "1216",
      landscapeHeight: "832",
      portraitWidth: "832",
      portraitHeight: "1216",
    });

    expect(config).toMatchObject({
      profile: "cuda-sdxl-high",
      defaultSteps: 25,
      defaultCfg: 7,
    });
    expect(config.dimensions).toEqual([
      { id: "square", label: "方形", width: 1024, height: 1024 },
      { id: "landscape", label: "横向", width: 1216, height: 832 },
      { id: "portrait", label: "纵向", width: 832, height: 1216 },
    ]);
  });

  it("rejects unsafe or malformed public overrides", () => {
    const config = resolveAiRuntimeConfig({
      defaultSteps: "100",
      defaultCfg: "NaN",
      squareWidth: "1001",
      landscapeHeight: "2048",
    });

    expect(config.profile).toBe("directml-lcm-lite");
    expect(config.defaultSteps).toBe(4);
    expect(config.defaultCfg).toBe(2);
    expect(config.dimensions[0]).toMatchObject({ width: 384, height: 384 });
    expect(config.dimensions[1]).toMatchObject({ width: 512, height: 384 });
  });
});
