"use client";

const SESSION_TIMEOUT_MS = 10_000;

interface AnonymousSessionResponse {
  userId: string;
  created: boolean;
}

interface ErrorResponse {
  message?: unknown;
}

let pendingSessionRequest: Promise<AnonymousSessionResponse> | null = null;

export class AnonymousSessionRequestError extends Error {
  constructor(
    message: string,
    readonly reason: "request" | "response" | "timeout",
  ) {
    super(message);
    this.name = "AnonymousSessionRequestError";
  }
}

function isAnonymousSessionResponse(
  value: unknown,
): value is AnonymousSessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AnonymousSessionResponse>;
  return (
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    typeof candidate.created === "boolean"
  );
}

function responseMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as ErrorResponse;
  return typeof candidate.message === "string" ? candidate.message : null;
}

async function requestAnonymousSession(
  fetcher: typeof fetch = fetch,
  timeoutMs = SESSION_TIMEOUT_MS,
): Promise<AnonymousSessionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher("/api/auth/anonymous-session", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new AnonymousSessionRequestError(
        responseMessage(body) ??
          `Supabase 会话初始化失败（HTTP ${String(response.status)}）。`,
        "response",
      );
    }
    if (!isAnonymousSessionResponse(body)) {
      throw new AnonymousSessionRequestError(
        "Supabase 会话接口返回了无效数据。",
        "response",
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AnonymousSessionRequestError(
        "Supabase 会话初始化超时，请检查网络后重试。",
        "timeout",
      );
    }
    if (error instanceof AnonymousSessionRequestError) {
      throw error;
    }
    throw new AnonymousSessionRequestError(
      error instanceof Error
        ? `无法建立 Supabase 会话：${error.message}`
        : "无法建立 Supabase 会话。",
      "request",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function ensureAnonymousSessionThroughServer(
  fetcher: typeof fetch = fetch,
  timeoutMs = SESSION_TIMEOUT_MS,
): Promise<AnonymousSessionResponse> {
  if (pendingSessionRequest) {
    return pendingSessionRequest;
  }

  const request = requestAnonymousSession(fetcher, timeoutMs);
  pendingSessionRequest = request;
  void request.then(
    () => {
      if (pendingSessionRequest === request) {
        pendingSessionRequest = null;
      }
    },
    () => {
      if (pendingSessionRequest === request) {
        pendingSessionRequest = null;
      }
    },
  );
  return request;
}
