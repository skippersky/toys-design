import type { EditorLayer, ImageLayer } from "@/store/editor-store";
import type {
  ExportFormat,
  ExportPackageRequest,
  ParsedAssetExportMetadata,
} from "@/types/export";

export const MAX_EXPORT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_EXPORT_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_EXPORT_LAYERS = 100;
export const MAX_DOCUMENT_DIMENSION = 10_000;
export const MAX_DECODED_LAYER_PIXELS = 16_000_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBlendMode(value: unknown): value is EditorLayer["blendMode"] {
  return (
    value === "normal" ||
    value === "multiply" ||
    value === "screen" ||
    value === "overlay"
  );
}

function hasValidBaseLayer(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    (value.parentId === undefined || typeof value.parentId === "string") &&
    isBoolean(value.visible) &&
    isBoolean(value.locked) &&
    isFiniteNumber(value.opacity) &&
    value.opacity >= 0 &&
    value.opacity <= 1 &&
    isBlendMode(value.blendMode) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width >= 0 &&
    value.width <= MAX_DOCUMENT_DIMENSION &&
    isFiniteNumber(value.height) &&
    value.height >= 0 &&
    value.height <= MAX_DOCUMENT_DIMENSION &&
    isFiniteNumber(value.scaleX) &&
    isFiniteNumber(value.scaleY) &&
    isFiniteNumber(value.rotation)
  );
}

function isImageLayer(value: Record<string, unknown>): boolean {
  return (
    value.type === "image" &&
    isNonEmptyString(value.src) &&
    (value.thumbnailSrc === undefined ||
      typeof value.thumbnailSrc === "string") &&
    isFiniteNumber(value.originalWidth) &&
    value.originalWidth > 0 &&
    isFiniteNumber(value.originalHeight) &&
    value.originalHeight > 0
  );
}

function isTextLayer(value: Record<string, unknown>): boolean {
  return (
    value.type === "text" &&
    typeof value.text === "string" &&
    isNonEmptyString(value.fontFamily) &&
    isFiniteNumber(value.fontSize) &&
    value.fontSize > 0 &&
    (value.fontStyle === "normal" ||
      value.fontStyle === "bold" ||
      value.fontStyle === "italic" ||
      value.fontStyle === "bold italic") &&
    (value.align === "left" ||
      value.align === "center" ||
      value.align === "right") &&
    isNonEmptyString(value.color) &&
    isFiniteNumber(value.lineHeight) &&
    value.lineHeight > 0
  );
}

function isShapeLayer(value: Record<string, unknown>): boolean {
  return (
    value.type === "shape" &&
    (value.shape === "rectangle" || value.shape === "ellipse") &&
    isNonEmptyString(value.fill) &&
    (value.stroke === undefined || typeof value.stroke === "string") &&
    isFiniteNumber(value.strokeWidth) &&
    value.strokeWidth >= 0 &&
    isFiniteNumber(value.cornerRadius) &&
    value.cornerRadius >= 0
  );
}

function isGroupLayer(value: Record<string, unknown>): boolean {
  return (
    value.type === "group" &&
    Array.isArray(value.childIds) &&
    value.childIds.every((id) => typeof id === "string")
  );
}

export function isEditorLayer(value: unknown): value is EditorLayer {
  if (!isRecord(value) || !hasValidBaseLayer(value)) {
    return false;
  }
  return (
    isImageLayer(value) ||
    isTextLayer(value) ||
    isShapeLayer(value) ||
    isGroupLayer(value)
  );
}

function parseDimension(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isFiniteNumber(value) || value < 1 || value > MAX_DOCUMENT_DIMENSION) {
    throw new Error("Export document dimensions are invalid.");
  }
  return Math.ceil(value);
}

export function parseAssetExportMetadata(
  value: unknown,
): ParsedAssetExportMetadata {
  if (!isRecord(value) || !Array.isArray(value.layers)) {
    throw new Error("Asset does not contain serializable editor layers.");
  }
  if (
    value.layers.length === 0 ||
    value.layers.length > MAX_EXPORT_LAYERS ||
    !value.layers.every(isEditorLayer)
  ) {
    throw new Error("Asset layers are invalid or exceed the export limit.");
  }

  const ids = new Set(value.layers.map((layer) => layer.id));
  if (ids.size !== value.layers.length) {
    throw new Error("Asset contains duplicate layer identifiers.");
  }

  const layersById = new Map(value.layers.map((layer) => [layer.id, layer]));
  const childOwners = new Map<string, string>();
  for (const layer of value.layers) {
    if (layer.parentId) {
      const parent = layersById.get(layer.parentId);
      if (!parent || parent.type !== "group") {
        throw new Error("Asset contains an invalid parent layer reference.");
      }
    }
    if (layer.type === "group") {
      if (new Set(layer.childIds).size !== layer.childIds.length) {
        throw new Error("Asset contains duplicate group child references.");
      }
      for (const childId of layer.childIds) {
        const child = layersById.get(childId);
        if (!child || child.parentId !== layer.id) {
          throw new Error("Asset contains an invalid group child reference.");
        }
        if (childOwners.has(childId)) {
          throw new Error("Asset contains a child in multiple groups.");
        }
        childOwners.set(childId, layer.id);
      }
    }
  }

  for (const layer of value.layers) {
    if (layer.parentId && childOwners.get(layer.id) !== layer.parentId) {
      throw new Error("Asset contains an incomplete group hierarchy.");
    }

    const ancestors = new Set<string>([layer.id]);
    let parentId = layer.parentId;
    while (parentId) {
      if (ancestors.has(parentId)) {
        throw new Error("Asset layer hierarchy contains a cycle.");
      }
      ancestors.add(parentId);
      parentId = layersById.get(parentId)?.parentId;
    }
  }

  if (!isRecord(value.layer_storage_keys)) {
    throw new Error("Asset image storage mapping is missing.");
  }
  const layerStorageKeys = Object.fromEntries(
    Object.entries(value.layer_storage_keys).flatMap(([id, path]) =>
      typeof path === "string" ? [[id, path]] : [],
    ),
  );
  const imageLayers = value.layers.filter(
    (layer): layer is ImageLayer => layer.type === "image",
  );
  if (imageLayers.some((layer) => !layerStorageKeys[layer.id])) {
    throw new Error("One or more image layers are missing a storage object.");
  }

  return {
    layers: value.layers,
    layerStorageKeys,
    documentWidth: parseDimension(value.document_width),
    documentHeight: parseDimension(value.document_height),
    modelRef: value.model_ref,
  };
}

export function parseExportPackageRequest(
  value: unknown,
): ExportPackageRequest | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.assetId) ||
    (value.format !== "psd" && value.format !== "zip") ||
    typeof value.include3d !== "boolean"
  ) {
    return null;
  }
  return {
    assetId: value.assetId,
    format: value.format,
    include3d: value.include3d,
  };
}

export function sanitizeFilename(value: string, fallback = "file"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function sanitizeLayerName(value: string): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (sanitized || "Layer").slice(0, 255);
}

export function isUserScopedPath(path: string, userId: string): boolean {
  if (
    path.includes("\\") ||
    path.includes("..") ||
    path.startsWith("/") ||
    /^https?:/i.test(path)
  ) {
    return false;
  }
  const [owner, ...segments] = path.split("/");
  return owner === userId && segments.length > 0 && segments.every(Boolean);
}

export function extensionForFormat(format: ExportFormat): ExportFormat {
  return format;
}
