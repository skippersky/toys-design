import { describe, expect, it } from "vitest";

import {
  buildEditorDocumentMetadata,
  buildImportedAssetRecords,
  extensionForImageContentType,
  inferDuplicatedImageStorageKeys,
  readLayerStorageKeys,
} from "@/lib/editor-document";
import type { ImageLayer, TextLayer } from "@/store/editor-store";

const imageLayer: ImageLayer = {
  id: "image-1",
  type: "image",
  name: "Image",
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
  src: "https://signed.example/image.png",
  originalWidth: 100,
  originalHeight: 100,
};

const textLayer: TextLayer = {
  id: "text-1",
  type: "text",
  name: "Text",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  x: 0,
  y: 0,
  width: 100,
  height: 30,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  text: "Hello",
  fontFamily: "Arial",
  fontSize: 20,
  fontStyle: "normal",
  align: "left",
  color: "#ffffff",
  lineHeight: 1.2,
};

describe("editor document metadata", () => {
  it("retains only storage objects used by active image layers", () => {
    const metadata = buildEditorDocumentMetadata(
      [imageLayer, textLayer],
      { stale: "user/stale.png" },
      { "image-1": "user/project/image.png" },
    );

    expect(metadata.layer_storage_keys).toEqual({
      "image-1": "user/project/image.png",
    });
    expect(readLayerStorageKeys(metadata)).toEqual(metadata.layer_storage_keys);
  });

  it("rejects an image layer without a private storage mapping", () => {
    expect(() => buildEditorDocumentMetadata([imageLayer], {})).toThrow(
      "missing its storage object",
    );
  });

  it("maps only supported image response types", () => {
    expect(extensionForImageContentType("image/png; charset=binary")).toBe(
      "png",
    );
    expect(extensionForImageContentType("text/html")).toBeNull();
  });

  it("reuses a source object's path for a duplicated image layer", () => {
    const duplicate = { ...imageLayer, id: "image-copy" };
    expect(
      inferDuplicatedImageStorageKeys([imageLayer, duplicate], [imageLayer], {
        "image-1": "user/project/image.png",
      }),
    ).toEqual({ "image-copy": "user/project/image.png" });
  });

  it("builds direct ownership metadata for newly imported image assets", () => {
    expect(
      buildImportedAssetRecords(
        [imageLayer, textLayer],
        { "image-1": "user/project/image.png", "text-1": "ignored" },
        "editor-asset-1",
      ),
    ).toEqual([
      {
        layer_id: "image-1",
        oss_key: "user/project/image.png",
        metadata: {
          imported_image: true,
          editor_asset_id: "editor-asset-1",
          layer_id: "image-1",
          name: "Image",
          width: 100,
          height: 100,
          original_width: 100,
          original_height: 100,
        },
      },
    ]);
  });
});
