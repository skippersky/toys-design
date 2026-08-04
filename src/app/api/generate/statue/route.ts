import { NextResponse, type NextRequest } from "next/server";
import { getComfyUIClient } from "@/lib/comfyui-client";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { ComfyUIProgress, ComfyUIWorkflow } from "@/types/comfyui";

export const runtime = "nodejs";

const GENERATION_TIMEOUT_MS = 120_000;
const PROGRESS_THROTTLE_MS = 1_000;
const MAX_CONCURRENT_GENERATIONS = 2;

type StatueStyle = "classic" | "marble" | "bronze" | "toy" | "premium";

interface GenerateStatueRequest {
  style: StatueStyle;
  ratio: string;
  ip_ref_url?: string;
  prompt: string;
}

interface LayerMeta {
  id: string;
  name: string;
  type: "image" | "mask" | "depth" | "metadata";
  oss_key: string;
}

interface CompleteEvent {
  asset_id: string;
  layers: LayerMeta[];
}

interface ErrorEvent {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRequest(value: unknown): GenerateStatueRequest | null {
  if (
    !isRecord(value) ||
    typeof value.style !== "string" ||
    typeof value.ratio !== "string" ||
    typeof value.prompt !== "string"
  ) {
    return null;
  }

  const styles: readonly string[] = [
    "classic",
    "marble",
    "bronze",
    "toy",
    "premium",
  ];

  if (!styles.includes(value.style) || value.prompt.trim().length === 0) {
    return null;
  }

  return {
    style: value.style as StatueStyle,
    ratio: value.ratio,
    prompt: value.prompt,
    ip_ref_url:
      typeof value.ip_ref_url === "string" ? value.ip_ref_url : undefined,
  };
}

function toWorkflow(input: GenerateStatueRequest): ComfyUIWorkflow {
  return {
    statue_prompt: {
      class_type: "StatueForgePrompt",
      inputs: {
        style: input.style,
        ratio: input.ratio,
        prompt: input.prompt,
        ip_ref_url: input.ip_ref_url ?? null,
      },
      _meta: {
        title: "StatueForge AI statue generation",
      },
    },
  };
}

function sseEvent(event: "progress" | "complete" | "error", data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(status: number, error: ErrorEvent) {
  return NextResponse.json(error, { status });
}

async function createPreviewUrl(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  ossKey?: string,
) {
  if (!ossKey) {
    return undefined;
  }

  const { data, error } = await supabase.storage
    .from("previews")
    .createSignedUrl(ossKey, 300);

  if (error) {
    console.error("Failed to sign preview URL", error);
    return undefined;
  }

  return data.signedUrl;
}

async function createAssetRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  projectId: string,
  promptId: string,
): Promise<CompleteEvent> {
  const { data, error } = await supabase
    .from("assets")
    .insert({
      project_id: projectId,
      type: "draft",
      oss_key: `comfyui/${promptId}`,
      metadata: { comfyui_prompt_id: promptId },
      version: 1,
      is_final: false,
    })
    .select("id, oss_key")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    asset_id: data.id as string,
    layers: [
      {
        id: data.id as string,
        name: "Generated statue draft",
        type: "image",
        oss_key: data.oss_key as string,
      },
    ],
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

  const body = parseRequest(await request.json().catch(() => null));
  if (!body) {
    return errorResponse(400, {
      code: "invalid_request",
      message: "Request body must include style, ratio, and prompt.",
    });
  }

  const { count, error: concurrentError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .in("status", ["queued", "running"]);

  if (concurrentError) {
    return errorResponse(500, {
      code: "concurrency_check_failed",
      message: concurrentError.message,
    });
  }

  if ((count ?? 0) >= MAX_CONCURRENT_GENERATIONS) {
    return errorResponse(429, {
      code: "too_many_generations",
      message: "Only two concurrent generations are allowed.",
    });
  }

  const creditCheck = (await supabase.rpc("check_credits", {
    p_user_id: user.id,
    p_credit_cost: 1,
  })) as { data: boolean | null; error: { message: string } | null };

  if (creditCheck.error || creditCheck.data !== true) {
    return errorResponse(402, {
      code: "insufficient_credits",
      message: "Not enough credits for this generation.",
    });
  }

  const projectInsert = await supabase
    .from("projects")
    .insert({
      profile_id: user.id,
      name: body.prompt.slice(0, 80),
      style: body.style,
      ratio: body.ratio,
      ip_ref_url: body.ip_ref_url ?? null,
      status: "running",
    })
    .select("id")
    .single();

  if (projectInsert.error) {
    return errorResponse(500, {
      code: "project_create_failed",
      message: projectInsert.error.message,
    });
  }

  const comfyui = getComfyUIClient();
  let queued: { prompt_id: string };

  try {
    queued = await comfyui.queuePrompt(toWorkflow(body));
  } catch {
    queued = await comfyui.queuePrompt(toWorkflow(body));
  }

  await supabase.from("generation_tasks").insert({
    asset_id: null,
    comfyui_prompt_id: queued.prompt_id,
    status: "queued",
    progress: 0,
    started_at: new Date().toISOString(),
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let lastProgressAt = 0;
      let closed = false;
      let unsubscribe = () => {};

      const write = (event: "progress" | "complete" | "error", data: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        unsubscribe();
        controller.close();
      };

      const timeout = setTimeout(() => {
        write("error", {
          code: "timeout",
          message: "Generation timed out after 120 seconds.",
        });
        void comfyui.cancelPrompt(queued.prompt_id);
        close();
      }, GENERATION_TIMEOUT_MS);

      request.signal.addEventListener("abort", () => {
        console.info("Generation SSE abandoned", {
          userId: user.id,
          promptId: queued.prompt_id,
        });
        clearTimeout(timeout);
        void comfyui.cancelPrompt(queued.prompt_id);
        close();
      });

      write("progress", { step: 0, total: 1 });

      unsubscribe = comfyui.subscribeProgress(
        queued.prompt_id,
        (progress: ComfyUIProgress) => {
          const now = Date.now();
          const shouldSendProgress =
            progress.completed ||
            progress.step === 0 ||
            now - lastProgressAt >= PROGRESS_THROTTLE_MS;

          if (!shouldSendProgress) {
            return;
          }

          lastProgressAt = now;

          if (!progress.completed) {
            write("progress", {
              step: progress.step,
              total: progress.total,
              preview_url: progress.previewUrl,
            });
            return;
          }

          void (async () => {
            try {
              clearTimeout(timeout);
              await comfyui.getHistory(queued.prompt_id);
              const previewKey = `previews/${queued.prompt_id}.png`;
              const previewUrl = await createPreviewUrl(supabase, previewKey);

              if (previewUrl) {
                write("progress", {
                  step: 1,
                  total: 1,
                  preview_url: previewUrl,
                });
              }

              const complete = await createAssetRecord(
                supabase,
                projectInsert.data.id as string,
                queued.prompt_id,
              );
              write("complete", complete);
              close();
            } catch (error) {
              write("error", {
                code: "completion_failed",
                message:
                  error instanceof Error
                    ? error.message
                    : "Generation completion failed.",
              });
              close();
            }
          })();
        },
      );
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
