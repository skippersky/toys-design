import { describe, expect, it } from "vitest";

import sharp from "sharp";

import { addPreviewWatermark } from "@/lib/watermark";

describe("addPreviewWatermark", () => {
  it("adds visible pixels without changing preview dimensions", async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: "#000000",
      },
    })
      .png()
      .toBuffer();
    const output = await addPreviewWatermark(
      source,
      "user-123",
      "2026-08-04T12:00:00.000Z",
    );
    const metadata = await sharp(output).metadata();
    const stats = await sharp(output).stats();

    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(400);
    expect(stats.channels[0]?.max).toBeGreaterThan(0);
    expect(output.equals(source)).toBe(false);
  });
});
