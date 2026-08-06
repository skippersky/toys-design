import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { NextResponse, type NextRequest } from "next/server";
import { v4 as uuidv4, validate as isUuid } from "uuid";

import {
  isUserScopedPath,
  MAX_EXPORT_FILE_BYTES,
  MAX_EXPORT_INPUT_BYTES,
  parseAssetExportMetadata,
  parseExportPackageRequest,
} from "@/lib/export-utils";
import { removeExportTemporaryDirectory } from "@/lib/export-temp";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  getSignedDownloadUrl,
  SIGNED_DOWNLOAD_EXPIRY_SECONDS,
} from "@/lib/storage";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { ImageLayer } from "@/store/editor-store";
import type {
  ExportImagePayload,
  ExportRequest,
  ExportWorkerMessage,
  ParsedAssetExportMetadata,
} from "@/types/export";

export const runtime = "nodejs";

const EXPORT_TIMEOUT_MS = 60_000;
const EXPORT_RATE_LIMIT = 5;
const EXPORT_RATE_WINDOW_MS = 60_000;
const MAX_CONCURRENT_EXPORTS = 2;
const activeExports = new Map<string, number>();

interface AssetRow {
  id: string;
  oss_key: string;
  metadata: unknown;
  projects: { profile_id: string } | { profile_id: string }[];
}

interface StorageInfo {
  size?: number;
  contentLength?: number;
}

function sseEvent(event: "progress" | "complete" | "error", data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(status: number, message: string) {
  return NextResponse.json({ code: "EXPORT_FAILED", message }, { status });
}

function ownsAsset(asset: AssetRow, userId: string): boolean {
  const projects = Array.isArray(asset.projects)
    ? asset.projects
    : [asset.projects];
  return projects.some((project) => project.profile_id === userId);
}

function reserveExport(userId: string): boolean {
  const current = activeExports.get(userId) ?? 0;
  if (current >= MAX_CONCURRENT_EXPORTS) {
    return false;
  }
  activeExports.set(userId, current + 1);
  return true;
}

function releaseExport(userId: string): void {
  const current = activeExports.get(userId) ?? 0;
  if (current <= 1) {
    activeExports.delete(userId);
  } else {
    activeExports.set(userId, current - 1);
  }
}

function assertWorkerTemporaryDirectory(path: string, taskId: string): string {
  const directory = resolve(/* turbopackIgnore: true */ path);
  if (
    dirname(directory) !== resolve(tmpdir()) ||
    !basename(directory).startsWith(`statueforge-export-${taskId}-`)
  ) {
    throw new Error("Worker returned an invalid temporary directory.");
  }
  return directory;
}

function assertWorkerArtifactPath(
  path: string,
  taskId: string,
  extension: "psd" | "zip",
): string {
  const directory = assertWorkerTemporaryDirectory(dirname(path), taskId);
  if (
    resolve(/* turbopackIgnore: true */ path) !==
    resolve(directory, `${taskId}.${extension}`)
  ) {
    throw new Error("Worker returned an invalid artifact path.");
  }
  return path;
}

async function hydrateImages(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  metadata: ParsedAssetExportMetadata,
  userId: string,
): Promise<ExportImagePayload[]> {
  const imageLayers = metadata.layers.filter(
    (layer): layer is ImageLayer => layer.type === "image",
  );
  const sources: Array<{ layerId: string; path: string; size: number }> = [];
  let totalBytes = 0;

  for (const layer of imageLayers) {
    const path = metadata.layerStorageKeys[layer.id];
    if (!path || !isUserScopedPath(path, userId)) {
      throw new Error(
        "An image layer is outside the authenticated user scope.",
      );
    }

    const infoResult = (await supabase.storage
      .from("assets")
      .info(path)) as unknown as {
      data: StorageInfo | null;
      error: { message: string } | null;
    };
    if (infoResult.error || !infoResult.data) {
      throw new Error("Unable to read image layer metadata.");
    }
    const size = infoResult.data.size ?? infoResult.data.contentLength ?? 0;
    if (size <= 0) {
      throw new Error("Image layer size is unavailable.");
    }
    totalBytes += size;
    if (totalBytes > MAX_EXPORT_INPUT_BYTES) {
      throw new Error("Export image inputs exceed the 100MB limit.");
    }
    sources.push({ layerId: layer.id, path, size });
  }

  const images: ExportImagePayload[] = [];
  for (const source of sources) {
    const result = await supabase.storage.from("assets").download(source.path);
    if (result.error) {
      throw new Error("Unable to download an image layer.");
    }
    const bytes = await result.data.arrayBuffer();
    if (bytes.byteLength !== source.size) {
      throw new Error("Image layer size changed during export.");
    }
    images.push({ layerId: source.layerId, bytes });
  }
  return images;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, "Authentication is required.");
  }

  const rateLimit = consumeRateLimit(
    `export:${user.id}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "EXPORT_FAILED", message: "Too many export requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const body = parseExportPackageRequest(
    await request.json().catch(() => null),
  );
  if (!body || !isUuid(body.assetId)) {
    return errorResponse(
      400,
      "A valid assetId, format and include3d are required.",
    );
  }

  const assetResult = (await supabase
    .from("assets")
    .select("id, oss_key, metadata, projects!inner(profile_id)")
    .eq("id", body.assetId)
    .single()) as unknown as {
    data: AssetRow | null;
    error: { message: string } | null;
  };
  if (
    assetResult.error ||
    !assetResult.data ||
    !ownsAsset(assetResult.data, user.id)
  ) {
    return errorResponse(404, "Asset was not found.");
  }

  let metadata: ParsedAssetExportMetadata;
  try {
    metadata = parseAssetExportMetadata(assetResult.data.metadata);
  } catch (error) {
    return errorResponse(
      422,
      error instanceof Error ? error.message : "Asset cannot be exported.",
    );
  }
  if (body.include3d && metadata.modelRef === undefined) {
    return errorResponse(422, "This asset does not contain a 3D reference.");
  }
  if (!reserveExport(user.id)) {
    return errorResponse(429, "Only two concurrent exports are allowed.");
  }

  const taskId = uuidv4();
  let worker: Worker | undefined;
  let artifactPath: string | undefined;
  let temporaryDirectory: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let released = false;
  let stop: (removeArtifact?: boolean) => Promise<void> = async () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const write = (
        event: "progress" | "complete" | "error",
        data: unknown,
      ): void => {
        if (!closed) {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        }
      };
      const close = (): void => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const streamIsClosed = (): boolean => closed;
      const release = (): void => {
        if (!released) {
          released = true;
          releaseExport(user.id);
        }
      };

      stop = async (removeArtifact = true): Promise<void> => {
        if (timeout) {
          clearTimeout(timeout);
        }
        const activeWorker = worker;
        worker = undefined;
        if (activeWorker) {
          await activeWorker.terminate().catch(() => 0);
        }
        if (removeArtifact && temporaryDirectory) {
          const directory = temporaryDirectory;
          artifactPath = undefined;
          temporaryDirectory = undefined;
          await removeExportTemporaryDirectory(directory).catch(() => {});
        }
        release();
      };

      const fail = async (message: string): Promise<void> => {
        if (closed) {
          return;
        }
        write("error", { code: "EXPORT_FAILED", message });
        await stop();
        close();
      };

      write("progress", { status: "processing" });
      timeout = setTimeout(() => {
        void fail("Export timed out after 60 seconds.");
      }, EXPORT_TIMEOUT_MS);

      request.signal.addEventListener(
        "abort",
        () => {
          console.info("Export SSE abandoned", { userId: user.id, taskId });
          closed = true;
          void stop();
        },
        { once: true },
      );

      void (async () => {
        try {
          const images = await hydrateImages(supabase, metadata, user.id);
          if (closed) {
            return;
          }
          const workerRequest: ExportRequest = {
            taskId,
            userId: user.id,
            format: body.format,
            include3d: body.include3d,
            layers: metadata.layers,
            documentWidth: metadata.documentWidth,
            documentHeight: metadata.documentHeight,
            images,
            modelRef: metadata.modelRef,
            timestamp: new Date().toISOString(),
          };

          worker = new Worker("./worker-runtime/workers/export-worker.js");
          worker.once("error", (error) => {
            console.error("Export worker error", { taskId, error });
            void fail("Export worker failed.");
          });
          worker.once("exit", (code) => {
            if (!closed && code !== 0) {
              void fail("Export worker stopped unexpectedly.");
            }
          });
          worker.on("message", (message: ExportWorkerMessage) => {
            if (message.taskId !== taskId || closed) {
              return;
            }
            if ("type" in message) {
              if (message.temporaryDirectory) {
                try {
                  temporaryDirectory = assertWorkerTemporaryDirectory(
                    message.temporaryDirectory,
                    taskId,
                  );
                } catch (error) {
                  console.error("Export worker path validation failed", {
                    taskId,
                    error,
                  });
                  void fail("Export worker failed.");
                  return;
                }
              }
              console.info("Export worker progress", {
                taskId,
                processId: message.processId,
                threadId: message.threadId,
                status: message.status,
              });
              write("progress", { status: message.status });
              return;
            }
            if (!message.success) {
              console.error("Export generation failed", {
                taskId,
                workerError: message.error,
              });
              void fail("Export generation failed.");
              return;
            }

            void (async () => {
              try {
                artifactPath = assertWorkerArtifactPath(
                  message.artifactPath,
                  taskId,
                  message.extension,
                );
                temporaryDirectory = dirname(artifactPath);
                const artifactStats = await stat(
                  /* turbopackIgnore: true */ artifactPath,
                );
                if (
                  artifactStats.size !== message.byteLength ||
                  artifactStats.size > MAX_EXPORT_FILE_BYTES
                ) {
                  throw new Error("Worker artifact size is invalid.");
                }
                if (streamIsClosed()) {
                  return;
                }
                write("progress", { status: "uploading" });
                const storagePath = `${user.id}/${taskId}.${message.extension}`;
                const upload = await supabase.storage
                  .from("exports")
                  .upload(
                    storagePath,
                    createReadStream(/* turbopackIgnore: true */ artifactPath),
                    {
                      contentType: message.contentType,
                      cacheControl: "0",
                      upsert: false,
                      duplex: "half",
                    },
                  );
                if (upload.error) {
                  throw new Error("Export upload failed.");
                }
                if (streamIsClosed()) {
                  await supabase.storage.from("exports").remove([storagePath]);
                  return;
                }

                try {
                  const downloadUrl = await getSignedDownloadUrl(storagePath);
                  if (streamIsClosed()) {
                    await supabase.storage
                      .from("exports")
                      .remove([storagePath]);
                    return;
                  }
                  const expiresAt = new Date(
                    Date.now() + SIGNED_DOWNLOAD_EXPIRY_SECONDS * 1000,
                  ).toISOString();
                  write("complete", { downloadUrl, expiresAt });
                } catch (error) {
                  await supabase.storage.from("exports").remove([storagePath]);
                  throw error;
                }

                await stop();
                close();
              } catch (error) {
                console.error("Export completion failed", { taskId, error });
                await fail("Export completion failed.");
              }
            })();
          });

          worker.postMessage(
            workerRequest,
            images.map((image) => image.bytes),
          );
        } catch (error) {
          console.error("Export preparation failed", { taskId, error });
          await fail("Export preparation failed.");
        }
      })();
    },
    async cancel() {
      closed = true;
      await stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
