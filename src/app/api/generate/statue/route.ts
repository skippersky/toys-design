import { NextResponse, type NextRequest } from "next/server";

import {
  buildComfyUIWorkflow,
  createGenerationSeed,
  getPromptTemplate,
  parseGenerationInput,
} from "@/lib/ai-generation";
import { ComfyUIRequestError, getComfyUIClient } from "@/lib/comfyui-client";
import {
  EDITOR_DOCUMENT_HEIGHT,
  EDITOR_DOCUMENT_WIDTH,
} from "@/lib/editor-document";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { refreshSessionWhenExpiring } from "@/lib/supabase/fresh-session";
import { addPreviewWatermark } from "@/lib/watermark";
import type { ImageLayer } from "@/store/editor-store";
import type { ComfyUIProgress, ComfyUIWorkflow } from "@/types/comfyui";
import type {
  GenerationErrorEvent,
  GenerationProgressEvent,
  GenerationResult,
  StatueGenerationInput,
} from "@/types/generation";

export const runtime = "nodejs";

const GENERATION_TIMEOUT_MS = 120_000;
const PREVIEW_TTL_SECONDS = 300;
const PROGRESS_THROTTLE_MS = 1_000;
const GENERATION_RATE_LIMIT = 10;
const GENERATION_RATE_WINDOW_MS = 60_000;
const GENERATION_CREDIT_COST = 1;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const MINIMUM_SESSION_VALIDITY_SECONDS =
  Math.ceil(GENERATION_TIMEOUT_MS / 1_000) + PREVIEW_TTL_SECONDS;

interface ReservedTask {
  ok: true;
  task_id: string;
  credits_remaining: number;
}

interface RejectedTask {
  ok: false;
  code: string;
  credits_remaining?: number;
}

interface CompletedTask {
  ok: true;
  asset_id: string;
  credits_remaining: number;
}

type ReserveTaskResult = ReservedTask | RejectedTask;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseReserveTask(value: unknown): ReserveTaskResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  if (
    value.ok &&
    typeof value.task_id === "string" &&
    typeof value.credits_remaining === "number"
  ) {
    return {
      ok: true,
      task_id: value.task_id,
      credits_remaining: value.credits_remaining,
    };
  }
  if (!value.ok && typeof value.code === "string") {
    return {
      ok: false,
      code: value.code,
      credits_remaining:
        typeof value.credits_remaining === "number"
          ? value.credits_remaining
          : undefined,
    };
  }
  return null;
}

function parseCompletedTask(value: unknown): CompletedTask | null {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    typeof value.asset_id !== "string" ||
    typeof value.credits_remaining !== "number"
  ) {
    return null;
  }
  return {
    ok: true,
    asset_id: value.asset_id,
    credits_remaining: value.credits_remaining,
  };
}

function sseEvent(
  event: "progress" | "complete" | "error",
  data: unknown,
): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(status: number, error: GenerationErrorEvent) {
  return NextResponse.json(error, { status });
}

async function queueWithOneServerRetry(
  workflow: ComfyUIWorkflow,
): Promise<{ prompt_id: string }> {
  const comfyui = getComfyUIClient();
  try {
    return await comfyui.queuePrompt(workflow);
  } catch (error) {
    if (
      !(error instanceof ComfyUIRequestError) ||
      error.status < 500 ||
      error.status >= 600
    ) {
      throw error;
    }
    return comfyui.queuePrompt(workflow);
  }
}

async function uploadReferenceImage(
  sourceUrl: string,
  taskId: string,
): Promise<string> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Reference image URL must use HTTP or HTTPS.");
  }
  const response = await fetch(url, { cache: "no-store" });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (!response.ok || !contentType?.startsWith("image/")) {
    throw new Error("Reference image could not be downloaded.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error("Reference image must be between 1 byte and 25MB.");
  }
  const extension = contentType === "image/jpeg" ? "jpg" : "png";
  const uploaded = await getComfyUIClient().uploadImage(
    new Blob([bytes], { type: contentType }),
    `statueforge-${taskId}.${extension}`,
  );
  return uploaded.subfolder
    ? `${uploaded.subfolder.replace(/\\/gu, "/")}/${uploaded.name}`
    : uploaded.name;
}

function createGeneratedLayer(
  input: StatueGenerationInput,
  imageUrl: string,
): ImageLayer {
  const scale = Math.min(
    1,
    (EDITOR_DOCUMENT_WIDTH * 0.8) / input.width,
    (EDITOR_DOCUMENT_HEIGHT * 0.8) / input.height,
  );
  const width = Math.round(input.width * scale);
  const height = Math.round(input.height * scale);
  return {
    id: crypto.randomUUID(),
    type: "image",
    name: `AI ${getPromptTemplate(input.templateId).name}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: Math.round((EDITOR_DOCUMENT_WIDTH - width) / 2),
    y: Math.round((EDITOR_DOCUMENT_HEIGHT - height) / 2),
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    src: imageUrl,
    thumbnailSrc: imageUrl,
    originalWidth: input.width,
    originalHeight: input.height,
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, {
      code: "unauthorized",
      message: "Authentication is required.",
    });
  }
  try {
    await refreshSessionWhenExpiring(
      supabase.auth,
      MINIMUM_SESSION_VALIDITY_SECONDS,
    );
  } catch (error) {
    return errorResponse(401, {
      code: "session_refresh_failed",
      message:
        error instanceof Error
          ? `登录会话刷新失败：${error.message}`
          : "登录会话刷新失败，请重新进入项目后重试。",
    });
  }

  const rateLimit = consumeRateLimit(
    `generation:${user.id}`,
    GENERATION_RATE_LIMIT,
    GENERATION_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "rate_limited", message: "Too many generation requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const input = parseGenerationInput(await request.json().catch(() => null));
  if (!input) {
    return errorResponse(400, {
      code: "invalid_request",
      message: "Generation parameters are invalid.",
    });
  }

  const checkpointName = process.env.COMFYUI_CHECKPOINT_NAME?.trim();
  if (!checkpointName) {
    return errorResponse(503, {
      code: "ai_service_not_configured",
      message:
        "COMFYUI_CHECKPOINT_NAME is missing. Configure an installed ComfyUI checkpoint and restart the server.",
    });
  }
  const seed = input.seed ?? createGenerationSeed();
  const samplerName = process.env.COMFYUI_SAMPLER_NAME?.trim() || "euler";
  const scheduler = process.env.COMFYUI_SCHEDULER?.trim() || "normal";
  const requestMetadata = {
    template: input.templateId,
    prompt: input.prompt,
    negative_prompt: input.negativePrompt ?? null,
    seed,
    model: checkpointName,
    width: input.width,
    height: input.height,
    steps: input.steps,
    cfg: input.cfg,
    sampler: samplerName,
    scheduler,
    deployment_profile:
      process.env.AI_DEPLOYMENT_PROFILE?.trim() || "unconfigured",
    mode: input.sourceImageUrl ? "img2img" : "txt2img",
  };
  const reservation = await supabase.rpc("reserve_generation_task", {
    p_project_id: input.projectId,
    p_editor_asset_id: input.editorAssetId,
    p_credit_cost: GENERATION_CREDIT_COST,
    p_request_metadata: requestMetadata,
  });
  if (reservation.error) {
    return errorResponse(503, {
      code: "generation_schema_unavailable",
      message:
        "AI generation database migration is not applied. Run the Step 5 migration first.",
    });
  }
  const reserved = parseReserveTask(reservation.data);
  if (!reserved) {
    return errorResponse(500, {
      code: "reservation_failed",
      message: "Generation reservation returned an invalid response.",
    });
  }
  if (!reserved.ok) {
    const status =
      reserved.code === "insufficient_credits"
        ? 402
        : reserved.code === "too_many_generations"
          ? 429
          : reserved.code.endsWith("not_found")
            ? 404
            : 400;
    return errorResponse(status, {
      code: reserved.code,
      message:
        reserved.code === "insufficient_credits"
          ? "额度不足，请充值后重试。"
          : reserved.code === "too_many_generations"
            ? "每位用户最多同时进行 2 个生成任务。"
            : "Unable to reserve this generation task.",
    });
  }

  const failTask = async (
    code: string,
    message: string,
    refund = true,
  ): Promise<void> => {
    const result = await supabase.rpc("fail_generation_task", {
      p_task_id: reserved.task_id,
      p_error_code: code,
      p_error_message: message,
      p_refund: refund,
    });
    if (result.error) {
      console.error("Unable to close failed generation task", {
        taskId: reserved.task_id,
        error: result.error.message,
      });
    }
  };

  let inputImageName: string | undefined;
  let queued: { prompt_id: string };
  try {
    if (input.sourceImageUrl) {
      inputImageName = await uploadReferenceImage(
        input.sourceImageUrl,
        reserved.task_id,
      );
    }
    const workflow = buildComfyUIWorkflow({
      input,
      checkpointName,
      seed,
      taskId: reserved.task_id,
      inputImageName,
      samplerName,
      scheduler,
    });
    queued = await queueWithOneServerRetry(workflow);
    const marked = await supabase.rpc("mark_generation_task_queued", {
      p_task_id: reserved.task_id,
      p_prompt_id: queued.prompt_id,
    });
    if (marked.error || marked.data !== true) {
      throw new Error("Generation task could not be marked as queued.");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ComfyUI queue failed.";
    await failTask("queue_failed", message);
    return errorResponse(502, { code: "queue_failed", message });
  }

  const comfyui = getComfyUIClient();
  let disconnectStream: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let completing = false;
      let lastProgressAt = 0;
      let unsubscribe = (): void => {};

      const write = (
        event: "progress" | "complete" | "error",
        data: unknown,
      ): void => {
        if (!closed) {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        }
      };
      const close = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may already have released a disconnected stream.
        }
      };
      const fail = async (code: string, message: string): Promise<void> => {
        if (closed || completing) {
          return;
        }
        completing = true;
        clearTimeout(timeout);
        write("error", { code, message } satisfies GenerationErrorEvent);
        await comfyui.cancelPrompt(queued.prompt_id).catch(() => undefined);
        await failTask(code, message);
        close();
      };

      const timeout = setTimeout(() => {
        void fail("timeout", "Generation timed out after 120 seconds.");
      }, GENERATION_TIMEOUT_MS);

      disconnectStream = () => {
        if (closed || completing) {
          return;
        }
        console.info("Generation SSE abandoned", {
          userId: user.id,
          taskId: reserved.task_id,
          promptId: queued.prompt_id,
        });
        void fail("client_disconnected", "Generation stream was disconnected.");
      };
      request.signal.addEventListener("abort", disconnectStream, {
        once: true,
      });

      const initialProgress: GenerationProgressEvent = {
        task_id: reserved.task_id,
        prompt_id: queued.prompt_id,
        status: "queued",
        step: 0,
        total: input.steps,
        credits_remaining: reserved.credits_remaining,
      };
      write("progress", initialProgress);

      unsubscribe = comfyui.subscribeProgress(
        queued.prompt_id,
        (progress: ComfyUIProgress) => {
          if (progress.error) {
            void fail("comfyui_execution_failed", progress.error);
            return;
          }
          if (progress.completed) {
            if (closed || completing) {
              return;
            }
            completing = true;
            clearTimeout(timeout);
            void (async () => {
              const uploadedPaths: string[] = [];
              try {
                await supabase.rpc("update_generation_task_progress", {
                  p_task_id: reserved.task_id,
                  p_status: "finalizing",
                  p_progress: 99,
                });
                write("progress", {
                  task_id: reserved.task_id,
                  prompt_id: queued.prompt_id,
                  status: "finalizing",
                  step: input.steps,
                  total: input.steps,
                } satisfies GenerationProgressEvent);

                const history = await comfyui.getHistory(queued.prompt_id);
                const outputImage = comfyui.getFirstOutputImage(
                  history,
                  queued.prompt_id,
                );
                if (!outputImage) {
                  throw new Error("ComfyUI history contains no output image.");
                }
                const source = Buffer.from(
                  await comfyui.downloadImage(outputImage),
                );
                const originalPath = `${user.id}/${input.projectId}/generated/${reserved.task_id}.png`;
                const previewPath = `${user.id}/${input.projectId}/previews/${reserved.task_id}.png`;
                const originalUpload = await supabase.storage
                  .from("assets")
                  .upload(originalPath, source, {
                    contentType: "image/png",
                    cacheControl: String(PREVIEW_TTL_SECONDS),
                    upsert: false,
                  });
                if (originalUpload.error) {
                  throw new Error(originalUpload.error.message);
                }
                uploadedPaths.push(originalPath);

                const watermarked = await addPreviewWatermark(
                  source,
                  user.id,
                  new Date().toISOString(),
                );
                const previewUpload = await supabase.storage
                  .from("assets")
                  .upload(previewPath, watermarked, {
                    contentType: "image/png",
                    cacheControl: String(PREVIEW_TTL_SECONDS),
                    upsert: false,
                  });
                if (previewUpload.error) {
                  throw new Error(previewUpload.error.message);
                }
                uploadedPaths.push(previewPath);

                const [originalSigned, previewSigned] = await Promise.all([
                  supabase.storage
                    .from("assets")
                    .createSignedUrl(originalPath, PREVIEW_TTL_SECONDS),
                  supabase.storage
                    .from("assets")
                    .createSignedUrl(previewPath, PREVIEW_TTL_SECONDS),
                ]);
                if (originalSigned.error || previewSigned.error) {
                  throw new Error("Generated image URLs could not be signed.");
                }

                const layer = createGeneratedLayer(
                  input,
                  originalSigned.data.signedUrl,
                );
                const completion = await supabase.rpc(
                  "complete_generation_task",
                  {
                    p_task_id: reserved.task_id,
                    p_storage_path: originalPath,
                    p_asset_metadata: {
                      ...requestMetadata,
                      comfyui_prompt_id: queued.prompt_id,
                      preview_oss_key: previewPath,
                    },
                    p_editor_layer: layer,
                  },
                );
                const completed = parseCompletedTask(completion.data);
                if (completion.error || !completed) {
                  throw new Error(
                    completion.error?.message ??
                      "Generation completion transaction failed.",
                  );
                }

                const result: GenerationResult = {
                  task_id: reserved.task_id,
                  prompt_id: queued.prompt_id,
                  project_id: input.projectId,
                  asset_id: completed.asset_id,
                  credits_remaining: completed.credits_remaining,
                  preview_url: previewSigned.data.signedUrl,
                  layer: { ...layer, asset_id: completed.asset_id },
                };
                write("complete", result);
                console.info("Generation completed", {
                  taskId: reserved.task_id,
                  promptId: queued.prompt_id,
                  assetId: completed.asset_id,
                  creditsRemaining: completed.credits_remaining,
                });
                close();
              } catch (error) {
                if (uploadedPaths.length > 0) {
                  await supabase.storage.from("assets").remove(uploadedPaths);
                }
                const message =
                  error instanceof Error
                    ? error.message
                    : "Generation finalization failed.";
                write("error", {
                  code: "completion_failed",
                  message,
                } satisfies GenerationErrorEvent);
                await failTask("completion_failed", message);
                close();
              }
            })();
            return;
          }

          const now = Date.now();
          if (now - lastProgressAt < PROGRESS_THROTTLE_MS) {
            return;
          }
          lastProgressAt = now;
          const percent = Math.min(
            98,
            Math.max(1, Math.round((progress.step / progress.total) * 100)),
          );
          void supabase.rpc("update_generation_task_progress", {
            p_task_id: reserved.task_id,
            p_status: "running",
            p_progress: percent,
          });
          write("progress", {
            task_id: reserved.task_id,
            prompt_id: queued.prompt_id,
            status: "running",
            step: progress.step,
            total: progress.total,
          } satisfies GenerationProgressEvent);
        },
      );
    },
    cancel() {
      disconnectStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
