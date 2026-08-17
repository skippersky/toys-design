import type {
  ComfyUIHistory,
  ComfyUIImageOutput,
  ComfyUIImageUploadResponse,
  ComfyUIProgress,
  ComfyUIProgressCallback,
  ComfyUIWebSocketMessage,
  ComfyUIWorkflow,
  QueuePromptRequest,
  QueuePromptResponse,
  UnsubscribeFn,
} from "@/types/comfyui";
import { requiredEnv } from "@/lib/env";

type WebSocketFactory = (url: string) => WebSocket;
type DelayFn = (ms: number) => Promise<void>;

const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseQueuePromptResponse(value: unknown): QueuePromptResponse {
  if (!isRecord(value) || typeof value.prompt_id !== "string") {
    throw new Error("ComfyUI returned an invalid queue response.");
  }
  return {
    prompt_id: value.prompt_id,
    number: typeof value.number === "number" ? value.number : undefined,
    node_errors: isRecord(value.node_errors) ? value.node_errors : undefined,
  };
}

function parseImageOutput(value: unknown): ComfyUIImageOutput | null {
  if (
    !isRecord(value) ||
    typeof value.filename !== "string" ||
    typeof value.subfolder !== "string" ||
    (value.type !== "input" && value.type !== "output" && value.type !== "temp")
  ) {
    return null;
  }
  return {
    filename: value.filename,
    subfolder: value.subfolder,
    type: value.type,
  };
}

function parseHistory(value: unknown): ComfyUIHistory {
  if (!isRecord(value)) {
    throw new Error("ComfyUI returned an invalid history response.");
  }

  return Object.fromEntries(
    Object.entries(value).map(([promptId, candidate]) => {
      if (!isRecord(candidate) || !isRecord(candidate.outputs)) {
        throw new Error("ComfyUI returned an invalid history entry.");
      }
      const outputs = Object.fromEntries(
        Object.entries(candidate.outputs).map(([nodeId, output]) => {
          if (!isRecord(output)) {
            throw new Error("ComfyUI returned an invalid output entry.");
          }
          const images = Array.isArray(output.images)
            ? output.images.flatMap((image) => {
                const parsed = parseImageOutput(image);
                return parsed ? [parsed] : [];
              })
            : undefined;
          return [nodeId, { ...output, images }];
        }),
      );
      const status = isRecord(candidate.status) ? candidate.status : {};
      const prompt = Array.isArray(candidate.prompt) ? candidate.prompt : [];
      return [
        promptId,
        {
          prompt: [
            typeof prompt[0] === "number" ? prompt[0] : 0,
            typeof prompt[1] === "string" ? prompt[1] : promptId,
            isRecord(prompt[2]) ? (prompt[2] as ComfyUIWorkflow) : {},
            isRecord(prompt[3]) ? prompt[3] : {},
            Array.isArray(prompt[4])
              ? prompt[4].filter(
                  (nodeId): nodeId is string => typeof nodeId === "string",
                )
              : [],
          ],
          outputs,
          status: {
            status_str:
              typeof status.status_str === "string"
                ? status.status_str
                : "unknown",
            completed: status.completed === true,
            messages: Array.isArray(status.messages)
              ? status.messages.flatMap((message) => {
                  if (
                    !Array.isArray(message) ||
                    typeof message[0] !== "string" ||
                    !isRecord(message[1])
                  ) {
                    return [];
                  }
                  return [[message[0], message[1]] as const];
                })
              : [],
          },
        },
      ];
    }),
  );
}

function parseImageUploadResponse(value: unknown): ComfyUIImageUploadResponse {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.subfolder !== "string" ||
    value.type !== "input"
  ) {
    throw new Error("ComfyUI returned an invalid upload response.");
  }
  return { name: value.name, subfolder: value.subfolder, type: value.type };
}

export class ComfyUIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ComfyUIRequestError";
  }
}

function parseWebSocketMessage(value: unknown): ComfyUIWebSocketMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (
    value.type === "progress" &&
    isRecord(value.data) &&
    typeof value.data.prompt_id === "string" &&
    typeof value.data.value === "number" &&
    typeof value.data.max === "number"
  ) {
    return {
      type: "progress",
      data: {
        prompt_id: value.data.prompt_id,
        value: value.data.value,
        max: value.data.max,
        node: typeof value.data.node === "string" ? value.data.node : undefined,
      },
    };
  }

  if (
    value.type === "executing" &&
    isRecord(value.data) &&
    typeof value.data.prompt_id === "string" &&
    (typeof value.data.node === "string" || value.data.node === null)
  ) {
    return {
      type: "executing",
      data: {
        prompt_id: value.data.prompt_id,
        node: value.data.node,
      },
    };
  }

  if (
    value.type === "executed" &&
    isRecord(value.data) &&
    typeof value.data.prompt_id === "string" &&
    typeof value.data.node === "string"
  ) {
    return {
      type: "executed",
      data: {
        prompt_id: value.data.prompt_id,
        node: value.data.node,
        output: isRecord(value.data.output) ? value.data.output : undefined,
      },
    };
  }

  if (
    value.type === "execution_error" &&
    isRecord(value.data) &&
    typeof value.data.prompt_id === "string" &&
    typeof value.data.exception_message === "string"
  ) {
    return {
      type: "execution_error",
      data: {
        prompt_id: value.data.prompt_id,
        node_id:
          typeof value.data.node_id === "string"
            ? value.data.node_id
            : undefined,
        node_type:
          typeof value.data.node_type === "string"
            ? value.data.node_type
            : undefined,
        exception_message: value.data.exception_message,
        exception_type:
          typeof value.data.exception_type === "string"
            ? value.data.exception_type
            : undefined,
        traceback: Array.isArray(value.data.traceback)
          ? value.data.traceback.filter(
              (line): line is string => typeof line === "string",
            )
          : undefined,
      },
    };
  }

  return null;
}

export class ComfyUIClient {
  private readonly httpUrl: string;
  private readonly wsUrl: string;
  private readonly clientId: string;
  private readonly createWebSocket: WebSocketFactory;
  private readonly delay: DelayFn;

  constructor(options?: {
    httpUrl?: string;
    wsUrl?: string;
    clientId?: string;
    createWebSocket?: WebSocketFactory;
    delay?: DelayFn;
  }) {
    this.httpUrl = options?.httpUrl ?? requiredEnv("COMFYUI_HTTP_URL");
    this.wsUrl = options?.wsUrl ?? requiredEnv("COMFYUI_WS_URL");
    this.clientId = options?.clientId ?? crypto.randomUUID();
    this.createWebSocket =
      options?.createWebSocket ?? ((url: string) => new WebSocket(url));
    this.delay =
      options?.delay ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  async queuePrompt(workflow: ComfyUIWorkflow): Promise<{ prompt_id: string }> {
    const body: QueuePromptRequest = {
      prompt: workflow,
      client_id: this.clientId,
    };

    const response = await fetch(new URL("/prompt", this.httpUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ComfyUIRequestError(
        `ComfyUI queue failed with ${String(response.status)}`,
        response.status,
      );
    }

    const data = parseQueuePromptResponse(await response.json());
    return { prompt_id: data.prompt_id };
  }

  async uploadImage(
    image: Blob,
    filename: string,
  ): Promise<ComfyUIImageUploadResponse> {
    const form = new FormData();
    form.append("image", image, filename);
    form.append("type", "input");
    form.append("overwrite", "true");
    const response = await fetch(new URL("/upload/image", this.httpUrl), {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new ComfyUIRequestError(
        `ComfyUI image upload failed with ${String(response.status)}`,
        response.status,
      );
    }
    return parseImageUploadResponse(await response.json());
  }

  subscribeProgress(
    promptId: string,
    callback: ComfyUIProgressCallback,
  ): UnsubscribeFn {
    let closed = false;
    let socket: WebSocket | null = null;
    let retries = 0;

    const connect = () => {
      if (closed) {
        return;
      }

      socket = this.createWebSocket(
        `${this.wsUrl.replace(/\/$/, "")}/ws?clientId=${this.clientId}`,
      );

      socket.onopen = () => {
        retries = 0;
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }
        const parsed = parseWebSocketMessage(payload);

        if (!parsed || parsed.data.prompt_id !== promptId) {
          return;
        }

        const progress = this.toProgress(parsed);
        if (progress) {
          callback(progress);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (closed || retries >= DEFAULT_BACKOFF_MS.length) {
          return;
        }

        const delayMs = DEFAULT_BACKOFF_MS[retries] ?? DEFAULT_BACKOFF_MS[2];
        retries += 1;
        void this.delay(delayMs).then(connect);
      };
    };

    connect();

    return () => {
      closed = true;
      socket?.close();
    };
  }

  async getHistory(promptId: string): Promise<ComfyUIHistory> {
    const response = await fetch(
      new URL(`/history/${promptId}`, this.httpUrl),
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new Error(`ComfyUI history failed with ${String(response.status)}`);
    }

    return parseHistory(await response.json());
  }

  getFirstOutputImage(
    history: ComfyUIHistory,
    promptId: string,
  ): ComfyUIImageOutput | null {
    const entry = history[promptId];
    if (!entry) {
      return null;
    }

    for (const output of Object.values(entry.outputs)) {
      const image = output.images?.find(
        (candidate) => candidate.type === "output" || candidate.type === "temp",
      );
      if (image) {
        return image;
      }
    }

    return null;
  }

  async downloadImage(image: ComfyUIImageOutput): Promise<ArrayBuffer> {
    const url = new URL("/view", this.httpUrl);
    url.searchParams.set("filename", image.filename);
    url.searchParams.set("subfolder", image.subfolder);
    url.searchParams.set("type", image.type);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `ComfyUI image download failed with ${String(response.status)}`,
      );
    }

    return response.arrayBuffer();
  }

  async cancelPrompt(promptId: string): Promise<void> {
    await Promise.allSettled([
      fetch(new URL("/queue", this.httpUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      }),
      fetch(new URL("/interrupt", this.httpUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      }),
    ]);
  }

  private toProgress(message: ComfyUIWebSocketMessage): ComfyUIProgress | null {
    if (message.type === "progress") {
      return {
        promptId: message.data.prompt_id,
        step: message.data.value,
        total: message.data.max,
        node: message.data.node,
        completed: false,
      };
    }

    if (message.type === "executing" && message.data.node === null) {
      return {
        promptId: message.data.prompt_id,
        step: 1,
        total: 1,
        completed: true,
      };
    }

    if (message.type === "execution_error") {
      return {
        promptId: message.data.prompt_id,
        step: 0,
        total: 1,
        error: message.data.exception_message,
        completed: false,
      };
    }

    return null;
  }
}

let singleton: ComfyUIClient | null = null;

export function getComfyUIClient() {
  singleton ??= new ComfyUIClient();
  return singleton;
}
