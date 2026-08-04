import { describe, expect, it } from "vitest";

import { getLayerBounds, intersectsViewport } from "@/lib/editor-geometry";
import type { ShapeLayer } from "@/store/editor-store";

const layer: ShapeLayer = {
  id: "shape-1",
  type: "shape",
  name: "Shape",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  shape: "rectangle",
  fill: "#ffffff",
  strokeWidth: 0,
  cornerRadius: 0,
};

describe("editor geometry", () => {
  it("calculates transformed layer bounds", () => {
    const bounds = getLayerBounds(layer, new Map([[layer.id, layer]]));

    expect(bounds).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("includes the viewport virtualization buffer", () => {
    const bounds = getLayerBounds(layer, new Map([[layer.id, layer]]));

    expect(
      intersectsViewport(bounds, {
        x: 350,
        y: 0,
        width: 100,
        height: 100,
        buffer: 100,
      }),
    ).toBe(true);
    expect(
      intersectsViewport(bounds, {
        x: 501,
        y: 0,
        width: 100,
        height: 100,
        buffer: 100,
      }),
    ).toBe(false);
  });
});
