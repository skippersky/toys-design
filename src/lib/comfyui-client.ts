import type {
  ComfyUIHistory,
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
          typeof value.data.node_id === "string" ? value.data.node_id : undefined,
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
      throw new Error(`ComfyUI queue failed with ${String(response.status)}`);
    }

    const data = (await response.json()) as QueuePromptResponse;
    return { prompt_id: data.prompt_id };
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
        const parsed = parseWebSocketMessage(JSON.parse(event.data));

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
    const response = await fetch(new URL(`/history/${promptId}`, this.httpUrl), {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`ComfyUI history failed with ${String(response.status)}`);
    }

    return (await response.json()) as ComfyUIHistory;
  }

  async cancelPrompt(promptId: string): Promise<void> {
    await fetch(new URL("/interrupt", this.httpUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId }),
    });
  }

  private toProgress(
    message: ComfyUIWebSocketMessage,
  ): ComfyUIProgress | null {
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
      throw new Error(message.data.exception_message);
    }

    return null;
  }
}

let singleton: ComfyUIClient | null = null;

export function getComfyUIClient() {
  singleton ??= new ComfyUIClient();
  return singleton;
}
