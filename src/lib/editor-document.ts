import { isEditorLayer, isRecord } from "@/lib/export-utils";
import type { EditorLayer } from "@/store/editor-store";

export const EDITOR_DOCUMENT_WIDTH = 3840;
export const EDITOR_DOCUMENT_HEIGHT = 2160;
export const EDITOR_ASSET_TYPE = "draft";

export interface EditorDocumentMetadata {
  editor_document: true;
  document_width: number;
  document_height: number;
  layers: readonly EditorLayer[];
  layer_storage_keys: Readonly<Record<string, string>>;
}

export interface ImportedAssetRecord {
  layer_id: string;
  oss_key: string;
  metadata: {
    imported_image: true;
    editor_asset_id: string;
    layer_id: string;
    name: string;
    width: number;
    height: number;
    original_width: number;
    original_height: number;
  };
}

export function parseEditorLayers(value: unknown): EditorLayer[] {
  if (!Array.isArray(value) || !value.every(isEditorLayer)) {
    throw new Error("Project contains invalid editor layers.");
  }
  return value;
}

export function readLayerStorageKeys(
  metadata: unknown,
): Record<string, string> {
  if (!isRecord(metadata) || !isRecord(metadata.layer_storage_keys)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata.layer_storage_keys).flatMap(([layerId, path]) =>
      typeof path === "string" && path.length > 0 ? [[layerId, path]] : [],
    ),
  );
}

export function buildEditorDocumentMetadata(
  layers: readonly EditorLayer[],
  previousStorageKeys: Readonly<Record<string, string>>,
  additionalStorageKeys: Readonly<Record<string, string>> = {},
): EditorDocumentMetadata {
  const storageKeys = { ...previousStorageKeys, ...additionalStorageKeys };
  const activeImageIds = new Set(
    layers.flatMap((layer) => (layer.type === "image" ? [layer.id] : [])),
  );
  const prunedStorageKeys = Object.fromEntries(
    Object.entries(storageKeys).filter(([layerId]) =>
      activeImageIds.has(layerId),
    ),
  );
  const missingImage = [...activeImageIds].find(
    (layerId) => !prunedStorageKeys[layerId],
  );
  if (missingImage) {
    throw new Error(
      `Image layer ${missingImage} is missing its storage object.`,
    );
  }

  return {
    editor_document: true,
    document_width: EDITOR_DOCUMENT_WIDTH,
    document_height: EDITOR_DOCUMENT_HEIGHT,
    layers,
    layer_storage_keys: prunedStorageKeys,
  };
}

export function inferDuplicatedImageStorageKeys(
  layers: readonly EditorLayer[],
  previousLayers: readonly EditorLayer[],
  previousStorageKeys: Readonly<Record<string, string>>,
): Record<string, string> {
  const pathBySource = new Map(
    previousLayers.flatMap((layer) => {
      if (layer.type !== "image") {
        return [];
      }
      const path = previousStorageKeys[layer.id];
      return path ? [[layer.src, path] as const] : [];
    }),
  );
  return Object.fromEntries(
    layers.flatMap((layer) => {
      if (layer.type !== "image" || previousStorageKeys[layer.id]) {
        return [];
      }
      const reusedPath = pathBySource.get(layer.src);
      return reusedPath ? [[layer.id, reusedPath]] : [];
    }),
  );
}

export function buildImportedAssetRecords(
  layers: readonly EditorLayer[],
  storageKeys: Readonly<Record<string, string>>,
  editorAssetId: string,
): ImportedAssetRecord[] {
  return Object.entries(storageKeys).flatMap(([layerId, ossKey]) => {
    const layer = layers.find(
      (candidate) => candidate.id === layerId && candidate.type === "image",
    );
    if (!layer || layer.type !== "image") {
      return [];
    }
    return [
      {
        layer_id: layerId,
        oss_key: ossKey,
        metadata: {
          imported_image: true,
          editor_asset_id: editorAssetId,
          layer_id: layerId,
          name: layer.name,
          width: layer.width,
          height: layer.height,
          original_width: layer.originalWidth,
          original_height: layer.originalHeight,
        },
      },
    ];
  });
}

export function extensionForImageContentType(
  contentType: string,
): string | null {
  switch (contentType.split(";", 1)[0]?.trim().toLowerCase()) {
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
