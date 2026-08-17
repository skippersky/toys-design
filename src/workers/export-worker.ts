import { ZipArchive } from "archiver";
import {
  writePsdBuffer,
  type BezierPath,
  type BlendMode as PsdBlendMode,
  type Layer as PsdLayer,
  type PixelData,
  type Psd,
} from "ag-psd";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isMainThread, parentPort, threadId } from "node:worker_threads";
import sharp from "sharp";

import {
  MAX_DECODED_LAYER_PIXELS,
  MAX_DOCUMENT_DIMENSION,
  MAX_EXPORT_FILE_BYTES,
  sanitizeFilename,
  sanitizeLayerName,
} from "../lib/export-utils.js";
import { removeExportTemporaryDirectory } from "../lib/export-temp.js";
import { addPreviewWatermark } from "../lib/watermark.js";
import type {
  EditorLayer,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "@/store/editor-store";
import type {
  ExportProgressStatus,
  ExportRequest,
  ExportWorkerMessage,
} from "@/types/export";

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewRaster {
  raw: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
  opacity: number;
  blendMode: EditorLayer["blendMode"];
  order: number;
}

interface PreviewComposite {
  input: Buffer;
  left: number;
  top: number;
  blend: "over" | "multiply" | "screen" | "overlay";
}

interface BuildContext {
  layersById: ReadonlyMap<string, EditorLayer>;
  imageBytesById: ReadonlyMap<string, Buffer>;
  orderById: ReadonlyMap<string, number>;
  previewRasters: PreviewRaster[];
  decodedPixels: number;
}

export interface GeneratedExportArtifact {
  artifactPath: string;
  extension: "psd" | "zip";
  contentType: "application/zip" | "image/vnd.adobe.photoshop";
  byteLength: number;
}

const IDENTITY_MATRIX: Matrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};
const PREVIEW_MAX_DIMENSION = 1600;

let activeTemporaryDirectory: string | undefined;
let shuttingDown = false;

function multiplyMatrices(parent: Matrix, child: Matrix): Matrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

function layerMatrix(layer: EditorLayer): Matrix {
  const radians = (layer.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * layer.scaleX,
    b: sine * layer.scaleX,
    c: -sine * layer.scaleY,
    d: cosine * layer.scaleY,
    e: layer.x,
    f: layer.y,
  };
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function transformedBounds(
  matrix: Matrix,
  width: number,
  height: number,
): Bounds {
  const points = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, width, 0),
    transformPoint(matrix, width, height),
    transformPoint(matrix, 0, height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function worldMatrixForLayer(
  layer: EditorLayer,
  layersById: ReadonlyMap<string, EditorLayer>,
): Matrix {
  const chain: EditorLayer[] = [];
  const visited = new Set<string>();
  let current: EditorLayer | undefined = layer;

  while (current) {
    if (visited.has(current.id)) {
      throw new Error("Layer hierarchy contains a cycle.");
    }
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentId ? layersById.get(current.parentId) : undefined;
  }

  return chain.reduce(
    (matrix, item) => multiplyMatrices(matrix, layerMatrix(item)),
    IDENTITY_MATRIX,
  );
}

function documentSize(request: ExportRequest, context: BuildContext) {
  const layerBounds = request.layers
    .filter((layer) => layer.type !== "group")
    .map((layer) =>
      transformedBounds(
        worldMatrixForLayer(layer, context.layersById),
        layer.width,
        layer.height,
      ),
    );
  const width = Math.ceil(
    Math.max(
      request.documentWidth ?? 1,
      ...layerBounds.map((bounds) => bounds.x + bounds.width),
    ),
  );
  const height = Math.ceil(
    Math.max(
      request.documentHeight ?? 1,
      ...layerBounds.map((bounds) => bounds.y + bounds.height),
    ),
  );

  if (
    width < 1 ||
    height < 1 ||
    width > MAX_DOCUMENT_DIMENSION ||
    height > MAX_DOCUMENT_DIMENSION
  ) {
    throw new Error("Export document dimensions exceed the safe limit.");
  }
  return { width, height };
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? "";
  });
}

function parseHexColor(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalized)
    ? normalized
    : fallback;
}

function rgbColor(value: string): { r: number; g: number; b: number } {
  const safe = parseHexColor(value, "#ffffff").slice(1);
  const expanded =
    safe.length === 3
      ? safe
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : safe;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function fontPostScriptName(layer: TextLayer): string {
  const family = layer.fontFamily.replace(/[^a-z0-9 ]/gi, "").trim();
  const compact = family.replace(/\s+/g, "") || "Arial";
  if (layer.fontStyle.includes("bold")) {
    return `${compact}-Bold`;
  }
  if (layer.fontStyle.includes("italic")) {
    return `${compact}-Italic`;
  }
  return compact === "Arial" ? "ArialMT" : `${compact}-Regular`;
}

function shapeSvg(layer: ShapeLayer): Buffer {
  const width = Math.max(1, Math.ceil(layer.width));
  const height = Math.max(1, Math.ceil(layer.height));
  const fill = parseHexColor(layer.fill, "#ffffff");
  const stroke = parseHexColor(layer.stroke ?? "transparent", "transparent");
  const strokeWidth = Math.max(0, layer.strokeWidth);
  const shape =
    layer.shape === "ellipse"
      ? `<ellipse cx="${String(width / 2)}" cy="${String(height / 2)}" rx="${String(Math.max(0, width / 2 - strokeWidth / 2))}" ry="${String(Math.max(0, height / 2 - strokeWidth / 2))}" />`
      : `<rect x="${String(strokeWidth / 2)}" y="${String(strokeWidth / 2)}" width="${String(Math.max(0, width - strokeWidth))}" height="${String(Math.max(0, height - strokeWidth))}" rx="${String(Math.min(layer.cornerRadius, width / 2, height / 2))}" />`;
  return Buffer.from(`
    <svg width="${String(width)}" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">
      <g fill="${fill}" stroke="${stroke}" stroke-width="${String(strokeWidth)}">${shape}</g>
    </svg>
  `);
}

function transformBezierPoint(matrix: Matrix, points: number[]): number[] {
  const transformed: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const point = transformPoint(matrix, points[index], points[index + 1]);
    transformed.push(point.x, point.y);
  }
  return transformed;
}

function shapeVectorPath(layer: ShapeLayer, matrix: Matrix): BezierPath {
  const width = Math.max(1, layer.width);
  const height = Math.max(1, layer.height);
  const kappa = 0.5522847498307936;
  let knots: Array<{ linked: boolean; points: number[] }>;

  if (layer.shape === "ellipse") {
    const centerX = width / 2;
    const centerY = height / 2;
    const controlX = centerX * kappa;
    const controlY = centerY * kappa;
    knots = [
      {
        linked: true,
        points: [
          width,
          centerY - controlY,
          width,
          centerY,
          width,
          centerY + controlY,
        ],
      },
      {
        linked: true,
        points: [
          centerX + controlX,
          height,
          centerX,
          height,
          centerX - controlX,
          height,
        ],
      },
      {
        linked: true,
        points: [0, centerY + controlY, 0, centerY, 0, centerY - controlY],
      },
      {
        linked: true,
        points: [centerX - controlX, 0, centerX, 0, centerX + controlX, 0],
      },
    ];
  } else {
    const radius = Math.min(
      Math.max(0, layer.cornerRadius),
      width / 2,
      height / 2,
    );
    const control = radius * kappa;
    knots = [
      {
        linked: radius > 0,
        points: [radius - control, 0, radius, 0, radius, 0],
      },
      {
        linked: radius > 0,
        points: [
          width - radius,
          0,
          width - radius,
          0,
          width - radius + control,
          0,
        ],
      },
      {
        linked: radius > 0,
        points: [width, radius - control, width, radius, width, radius],
      },
      {
        linked: radius > 0,
        points: [
          width,
          height - radius,
          width,
          height - radius,
          width,
          height - radius + control,
        ],
      },
      {
        linked: radius > 0,
        points: [
          width - radius + control,
          height,
          width - radius,
          height,
          width - radius,
          height,
        ],
      },
      {
        linked: radius > 0,
        points: [radius, height, radius, height, radius - control, height],
      },
      {
        linked: radius > 0,
        points: [
          0,
          height - radius + control,
          0,
          height - radius,
          0,
          height - radius,
        ],
      },
      {
        linked: radius > 0,
        points: [0, radius, 0, radius, 0, radius - control],
      },
    ];
  }

  return {
    open: false,
    operation: "combine",
    fillRule: "non-zero",
    knots: knots.map((knot) => ({
      linked: knot.linked,
      points: transformBezierPoint(matrix, knot.points),
    })),
  };
}

function addShapeVectorMetadata(
  psdLayer: PsdLayer,
  layer: ShapeLayer,
  matrix: Matrix,
): void {
  psdLayer.vectorFill = { type: "color", color: rgbColor(layer.fill) };
  psdLayer.vectorMask = {
    fillStartsWithAllPixels: false,
    paths: [shapeVectorPath(layer, matrix)],
  };
  if (layer.stroke && layer.strokeWidth > 0) {
    psdLayer.vectorStroke = {
      strokeEnabled: true,
      fillEnabled: true,
      lineWidth: { units: "Pixels", value: layer.strokeWidth },
      lineDashOffset: { units: "Pixels", value: 0 },
      miterLimit: 100,
      lineCapType: "butt",
      lineJoinType: layer.cornerRadius > 0 ? "round" : "miter",
      lineAlignment: "inside",
      scaleLock: false,
      strokeAdjust: false,
      lineDashSet: [],
      blendMode: "normal",
      opacity: 1,
      content: { type: "color", color: rgbColor(layer.stroke) },
      resolution: 72,
    };
  }
}

function textSvg(layer: TextLayer): Buffer {
  const width = Math.max(1, Math.ceil(layer.width));
  const height = Math.max(1, Math.ceil(layer.height));
  const fill = parseHexColor(layer.color, "#ffffff");
  const anchor =
    layer.align === "center"
      ? "middle"
      : layer.align === "right"
        ? "end"
        : "start";
  const x =
    layer.align === "center" ? width / 2 : layer.align === "right" ? width : 0;
  const lines = layer.text.split("\n");
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${String(x)}" dy="${String(index === 0 ? layer.fontSize : layer.fontSize * layer.lineHeight)}">${xmlEscape(line)}</tspan>`,
    )
    .join("");

  return Buffer.from(`
    <svg width="${String(width)}" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">
      <text x="${String(x)}" y="0" text-anchor="${anchor}" dominant-baseline="hanging"
        fill="${fill}" font-family="${xmlEscape(layer.fontFamily)}" font-size="${String(layer.fontSize)}"
        font-weight="${layer.fontStyle.includes("bold") ? "700" : "400"}"
        font-style="${layer.fontStyle.includes("italic") ? "italic" : "normal"}">${tspans}</text>
    </svg>
  `);
}

function pixelData(buffer: Buffer, width: number, height: number): PixelData {
  return {
    data: new Uint8ClampedArray(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ),
    width,
    height,
  };
}

async function transformRaster(
  source: Buffer,
  layer: ImageLayer | ShapeLayer | TextLayer,
  matrix: Matrix,
  context: BuildContext,
) {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const rotation = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  const targetWidth = Math.max(1, Math.round(layer.width * scaleX));
  const targetHeight = Math.max(1, Math.round(layer.height * scaleY));
  const estimatedPixels = targetWidth * targetHeight;
  context.decodedPixels += estimatedPixels;
  if (context.decodedPixels > MAX_DECODED_LAYER_PIXELS) {
    throw new Error("Decoded layer pixels exceed the worker memory limit.");
  }

  let transformer = sharp(
    source,
    layer.type === "image" ? undefined : { density: 144 },
  )
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .ensureAlpha();
  if (matrix.a * matrix.d - matrix.b * matrix.c < 0) {
    transformer = transformer.flop();
  }
  const { data, info } = await transformer
    .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = transformedBounds(matrix, layer.width, layer.height);
  const left = Math.floor(bounds.x);
  const top = Math.floor(bounds.y);
  return {
    raw: data,
    width: info.width,
    height: info.height,
    left,
    top,
  };
}

function commonPsdProperties(layer: EditorLayer) {
  return {
    name: sanitizeLayerName(layer.name),
    opacity: Math.min(1, Math.max(0, layer.opacity)),
    blendMode: layer.blendMode as PsdBlendMode,
    hidden: !layer.visible,
  };
}

async function buildRasterLayer(
  layer: ImageLayer | ShapeLayer | TextLayer,
  parentMatrix: Matrix,
  inheritedVisible: boolean,
  inheritedOpacity: number,
  context: BuildContext,
): Promise<PsdLayer> {
  const matrix = multiplyMatrices(parentMatrix, layerMatrix(layer));
  const source =
    layer.type === "image"
      ? context.imageBytesById.get(layer.id)
      : layer.type === "shape"
        ? shapeSvg(layer)
        : textSvg(layer);
  if (!source) {
    throw new Error(`Image bytes are missing for layer ${layer.id}.`);
  }
  const raster = await transformRaster(source, layer, matrix, context);
  const psdLayer: PsdLayer = {
    ...commonPsdProperties(layer),
    top: raster.top,
    left: raster.left,
    bottom: raster.top + raster.height,
    right: raster.left + raster.width,
    imageData: pixelData(raster.raw, raster.width, raster.height),
  };

  if (layer.type === "text") {
    psdLayer.text = {
      text: layer.text,
      transform: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
      shapeType: "box",
      boxBounds: [0, 0, layer.width, layer.height],
      style: {
        font: { name: fontPostScriptName(layer) },
        fontSize: layer.fontSize,
        fauxBold: layer.fontStyle.includes("bold"),
        fauxItalic: layer.fontStyle.includes("italic"),
        leading: layer.fontSize * layer.lineHeight,
        fillColor: rgbColor(layer.color),
      },
      paragraphStyle: {
        justification: layer.align,
      },
    };
  }

  if (layer.type === "shape") {
    addShapeVectorMetadata(psdLayer, layer, matrix);
  }

  if (inheritedVisible && layer.visible) {
    context.previewRasters.push({
      ...raster,
      opacity: inheritedOpacity * layer.opacity,
      blendMode: layer.blendMode,
      order: context.orderById.get(layer.id) ?? 0,
    });
  }
  return psdLayer;
}

async function buildPsdLayer(
  layer: EditorLayer,
  parentMatrix: Matrix,
  inheritedVisible: boolean,
  inheritedOpacity: number,
  context: BuildContext,
  visited: ReadonlySet<string>,
): Promise<PsdLayer> {
  if (visited.has(layer.id)) {
    throw new Error("Layer hierarchy contains a cycle.");
  }
  const nextVisited = new Set(visited).add(layer.id);
  if (layer.type !== "group") {
    return buildRasterLayer(
      layer,
      parentMatrix,
      inheritedVisible,
      inheritedOpacity,
      context,
    );
  }

  const matrix = multiplyMatrices(parentMatrix, layerMatrix(layer));
  const children = await Promise.all(
    [...layer.childIds].reverse().map(async (childId) => {
      const child = context.layersById.get(childId);
      if (!child) {
        throw new Error(`Group child ${childId} is missing.`);
      }
      return buildPsdLayer(
        child,
        matrix,
        inheritedVisible && layer.visible,
        inheritedOpacity * layer.opacity,
        context,
        nextVisited,
      );
    }),
  );
  return {
    ...commonPsdProperties(layer),
    opened: true,
    children,
  };
}

async function writeBufferStream(path: string, buffer: Buffer): Promise<void> {
  await pipeline(
    Readable.from([buffer]),
    createWriteStream(path, { flags: "wx" }),
  );
}

function withAdjustedOpacity(raw: Buffer, opacity: number): Buffer {
  if (opacity >= 1) {
    return raw;
  }
  const adjusted = Buffer.from(raw);
  for (let index = 3; index < adjusted.length; index += 4) {
    adjusted[index] = Math.round((adjusted[index] ?? 0) * opacity);
  }
  return adjusted;
}

async function createWatermarkedPreview(
  width: number,
  height: number,
  rasters: readonly PreviewRaster[],
  userId: string,
  timestamp: string,
): Promise<Buffer> {
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(width, height));
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const pendingComposites = await Promise.all(
    [...rasters]
      .sort((left, right) => left.order - right.order)
      .map(async (raster): Promise<PreviewComposite | null> => {
        const blend: "over" | "multiply" | "screen" | "overlay" =
          raster.blendMode === "normal" ? "over" : raster.blendMode;
        const scaledWidth = Math.max(1, Math.round(raster.width * scale));
        const scaledHeight = Math.max(1, Math.round(raster.height * scale));
        const left = Math.round(raster.left * scale);
        const top = Math.round(raster.top * scale);
        const cropLeft = Math.max(0, -left);
        const cropTop = Math.max(0, -top);
        const visibleWidth = Math.min(
          scaledWidth - cropLeft,
          previewWidth - Math.max(0, left),
        );
        const visibleHeight = Math.min(
          scaledHeight - cropTop,
          previewHeight - Math.max(0, top),
        );
        if (visibleWidth <= 0 || visibleHeight <= 0) {
          return null;
        }

        let image = sharp(withAdjustedOpacity(raster.raw, raster.opacity), {
          raw: {
            width: raster.width,
            height: raster.height,
            channels: 4,
          },
        }).resize({
          width: scaledWidth,
          height: scaledHeight,
          fit: "fill",
        });
        if (
          cropLeft > 0 ||
          cropTop > 0 ||
          visibleWidth < scaledWidth ||
          visibleHeight < scaledHeight
        ) {
          image = image.extract({
            left: cropLeft,
            top: cropTop,
            width: visibleWidth,
            height: visibleHeight,
          });
        }
        return {
          input: await image.png().toBuffer(),
          left: Math.max(0, left),
          top: Math.max(0, top),
          blend,
        };
      }),
  );
  const composites = pendingComposites.filter(
    (item): item is PreviewComposite => item !== null,
  );
  const preview = await sharp({
    create: {
      width: previewWidth,
      height: previewHeight,
      channels: 4,
      background: { r: 24, g: 24, b: 27, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
  return addPreviewWatermark(preview, userId, timestamp);
}

async function createZip(
  zipPath: string,
  psdPath: string,
  previewPath: string,
  modelPath?: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(zipPath, { flags: "wx" });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.once("close", resolvePromise);
    output.once("error", rejectPromise);
    archive.once("error", rejectPromise);
    archive.on("warning", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        rejectPromise(error);
      }
    });
    archive.pipe(output);
    archive.file(psdPath, { name: `${sanitizeFilename("master")}.psd` });
    archive.file(previewPath, {
      name: `${sanitizeFilename("render_preview")}.png`,
    });
    if (modelPath) {
      archive.file(modelPath, {
        name: `${sanitizeFilename("model_ref")}.json`,
      });
    }
    void archive.finalize();
  });
}

export async function generateExportArtifact(
  request: ExportRequest,
  onProgress: (status: ExportProgressStatus) => void = () => {},
): Promise<GeneratedExportArtifact> {
  const safeTaskId = sanitizeFilename(request.taskId, "task");
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), `statueforge-export-${safeTaskId}-`),
  );
  activeTemporaryDirectory = temporaryDirectory;
  await mkdir(temporaryDirectory, { recursive: true });

  try {
    onProgress("rendering");
    const context: BuildContext = {
      layersById: new Map(request.layers.map((layer) => [layer.id, layer])),
      imageBytesById: new Map(
        request.images.map((image) => [
          image.layerId,
          Buffer.from(image.bytes),
        ]),
      ),
      orderById: new Map(
        request.layers.map((layer, index) => [layer.id, index]),
      ),
      previewRasters: [],
      decodedPixels: 0,
    };
    const size = documentSize(request, context);
    const rootLayers = request.layers.filter((layer) => !layer.parentId);
    const children = await Promise.all(
      [...rootLayers]
        .reverse()
        .map((layer) =>
          buildPsdLayer(layer, IDENTITY_MATRIX, true, 1, context, new Set()),
        ),
    );
    const psd: Psd = {
      width: size.width,
      height: size.height,
      children,
    };
    const psdBuffer = writePsdBuffer(psd, {
      noBackground: true,
      trimImageData: false,
      generateThumbnail: false,
      invalidateTextLayers: false,
    });
    if (psdBuffer.byteLength > MAX_EXPORT_FILE_BYTES) {
      throw new Error("Generated PSD exceeds the 100MB export limit.");
    }
    const psdPath = join(temporaryDirectory, `${safeTaskId}.psd`);
    await writeBufferStream(psdPath, psdBuffer);

    if (request.format === "psd") {
      return {
        artifactPath: psdPath,
        extension: "psd",
        contentType: "image/vnd.adobe.photoshop",
        byteLength: psdBuffer.byteLength,
      };
    }

    onProgress("packaging");
    const preview = await createWatermarkedPreview(
      size.width,
      size.height,
      context.previewRasters,
      request.userId,
      request.timestamp,
    );
    const previewPath = join(temporaryDirectory, "render-preview.png");
    await writeBufferStream(previewPath, preview);

    let modelPath: string | undefined;
    if (request.include3d) {
      const modelJson = JSON.stringify(request.modelRef);
      if (!modelJson) {
        throw new Error("3D reference metadata is missing.");
      }
      if (Buffer.byteLength(modelJson) > 1024 * 1024) {
        throw new Error("3D reference metadata exceeds the 1MB limit.");
      }
      modelPath = join(temporaryDirectory, "model-ref.json");
      await writeBufferStream(modelPath, Buffer.from(modelJson));
    }

    const zipPath = join(temporaryDirectory, `${safeTaskId}.zip`);
    await createZip(zipPath, psdPath, previewPath, modelPath);
    const zipStats = await stat(zipPath);
    if (zipStats.size > MAX_EXPORT_FILE_BYTES) {
      throw new Error("Generated ZIP exceeds the 100MB export limit.");
    }
    await Promise.all([
      unlink(psdPath),
      unlink(previewPath),
      ...(modelPath ? [unlink(modelPath)] : []),
    ]);
    return {
      artifactPath: zipPath,
      extension: "zip",
      contentType: "application/zip",
      byteLength: zipStats.size,
    };
  } catch (error) {
    await removeExportTemporaryDirectory(temporaryDirectory);
    activeTemporaryDirectory = undefined;
    throw error;
  }
}

function postMessage(message: ExportWorkerMessage): void {
  if (!shuttingDown) {
    parentPort?.postMessage(message);
  }
}

function postFailure(taskId: string, error: unknown): void {
  postMessage({
    taskId,
    success: false,
    error: error instanceof Error ? error.message : "Export worker failed.",
    threadId,
    processId: process.pid,
  });
}

async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (activeTemporaryDirectory) {
    await removeExportTemporaryDirectory(activeTemporaryDirectory).catch(
      () => {},
    );
  }
}

if (!isMainThread && parentPort) {
  parentPort.once("message", (request: ExportRequest) => {
    postMessage({
      taskId: request.taskId,
      type: "progress",
      status: "processing",
      threadId,
      processId: process.pid,
    });
    void generateExportArtifact(request, (status) => {
      postMessage({
        taskId: request.taskId,
        type: "progress",
        status,
        temporaryDirectory: activeTemporaryDirectory,
        threadId,
        processId: process.pid,
      });
    })
      .then((artifact) => {
        activeTemporaryDirectory = undefined;
        postMessage({
          taskId: request.taskId,
          success: true,
          ...artifact,
          threadId,
          processId: process.pid,
        });
      })
      .catch((error: unknown) => {
        postFailure(request.taskId, error);
      });
  });
  parentPort.once("close", () => {
    void gracefulShutdown();
  });
  process.once("disconnect", () => {
    void gracefulShutdown();
  });
  process.once("uncaughtException", (error) => {
    postFailure("unknown", error);
    void gracefulShutdown();
  });
  process.once("unhandledRejection", (error) => {
    postFailure("unknown", error);
    void gracefulShutdown();
  });
}
