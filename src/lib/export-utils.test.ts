import { describe, expect, it } from "vitest";

import {
  isUserScopedPath,
  parseAssetExportMetadata,
  parseExportPackageRequest,
  sanitizeFilename,
} from "@/lib/export-utils";
import type { ImageLayer } from "@/store/editor-store";

const imageLayer: ImageLayer = {
  id: "image-1",
  type: "image",
  name: "Hero image",
  visible: true,
  locked: false,
  opacity: 0.75,
  blendMode: "multiply",
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  src: "ephemeral-preview-only",
  originalWidth: 1920,
  originalHeight: 1080,
};

describe("export utilities", () => {
  it("parses the public request contract", () => {
    expect(
      parseExportPackageRequest({
        assetId: "asset-id",
        format: "zip",
        include3d: true,
      }),
    ).toEqual({ assetId: "asset-id", format: "zip", include3d: true });
    expect(parseExportPackageRequest({ format: "psd" })).toBeNull();
  });

  it("validates serialized layers and private storage mappings", () => {
    const parsed = parseAssetExportMetadata({
      layers: [imageLayer],
      layer_storage_keys: { "image-1": "user-id/layers/hero.png" },
      document_width: 3840,
      document_height: 2160,
    });

    expect(parsed.layers[0]?.blendMode).toBe("multiply");
    expect(parsed.layerStorageKeys["image-1"]).toBe("user-id/layers/hero.png");
  });

  it("rejects image layers without a storage object", () => {
    expect(() =>
      parseAssetExportMetadata({
        layers: [imageLayer],
        layer_storage_keys: {},
      }),
    ).toThrow("missing a storage object");
  });

  it("rejects inconsistent and cyclic group hierarchies", () => {
    const groupBase = {
      name: "Group",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    } as const;

    expect(() =>
      parseAssetExportMetadata({
        layers: [
          { ...groupBase, id: "group-a", type: "group", childIds: [] },
          { ...imageLayer, parentId: "group-a" },
        ],
        layer_storage_keys: { "image-1": "user-id/layers/hero.png" },
      }),
    ).toThrow("incomplete group hierarchy");

    expect(() =>
      parseAssetExportMetadata({
        layers: [
          {
            ...groupBase,
            id: "group-a",
            type: "group",
            parentId: "group-b",
            childIds: ["group-b"],
          },
          {
            ...groupBase,
            id: "group-b",
            type: "group",
            parentId: "group-a",
            childIds: ["group-a"],
          },
        ],
        layer_storage_keys: {},
      }),
    ).toThrow("contains a cycle");
  });

  it("sanitizes archive filenames and traversal paths", () => {
    expect(sanitizeFilename(" My Promo / Final?.PSD ")).toBe(
      "my-promo-final-.psd",
    );
    expect(isUserScopedPath("user-id/exports/file.psd", "user-id")).toBe(true);
    expect(isUserScopedPath("other/file.psd", "user-id")).toBe(false);
    expect(isUserScopedPath("user-id/../secret", "user-id")).toBe(false);
    expect(isUserScopedPath("https://internal/file", "user-id")).toBe(false);
  });
});
