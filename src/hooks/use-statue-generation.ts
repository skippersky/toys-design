"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  isActiveGenerationStatus,
  type ActiveGenerationStatus,
  useGenerationStore,
} from "@/store/generation-store";
import type {
  GenerationErrorEvent,
  GenerationProgressEvent,
  GenerationResult,
  GenerationSseEvent,
  StatueGenerationInput,
} from "@/types/generation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProgressEvent(value: unknown): value is GenerationProgressEvent {
  return (
    isRecord(value) &&
    typeof value.task_id === "string" &&
    (value.status === "queued" ||
      value.status === "running" ||
      value.status === "finalizing") &&
    typeof value.step === "number" &&
    typeof value.total === "number" &&
    (value.prompt_id === undefined || typeof value.prompt_id === "string") &&
    (value.preview_url === undefined || typeof value.preview_url === "string")
  );
}

function isImageLayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "image" &&
    typeof value.id === "string" &&
    typeof value.asset_id === "string" &&
    typeof value.name === "string" &&
    typeof value.src === "string" &&
    typeof value.originalWidth === "number" &&
    typeof value.originalHeight === "number"
  );
}

function isGenerationResult(value: unknown): value is GenerationResult {
  return (
    isRecord(value) &&
    typeof value.task_id === "string" &&
    typeof value.prompt_id === "string" &&
    typeof value.project_id === "string" &&
    typeof value.asset_id === "string" &&
    typeof value.credits_remaining === "number" &&
    typeof value.preview_url === "string" &&
    isImageLayer(value.layer)
  );
}

function isErrorEvent(value: unknown): value is GenerationErrorEvent {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

export function parseGenerationSseBlock(
  block: string,
): GenerationSseEvent | null {
  const lines = block.replace(/\r\n/gu, "\n").split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const dataText = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!event || !dataText) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataText) as unknown;
  } catch {
    return null;
  }
  if (event === "progress" && isProgressEvent(data)) {
    return { event, data };
  }
  if (event === "complete" && isGenerationResult(data)) {
    return { event, data };
  }
  if (event === "error" && isErrorEvent(data)) {
    return { event, data };
  }
  return null;
}

async function readSse(
  response: Response,
  onEvent: (event: GenerationSseEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response did not include a readable body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder
      .decode(chunk.value, { stream: !done })
      .replace(/\r\n/gu, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const event = parseGenerationSseBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) {
        onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) {
    const event = parseGenerationSseBlock(buffer);
    if (event) {
      onEvent(event);
    }
  }
}

export async function readGenerationHttpError(
  response: Response,
): Promise<GenerationErrorEvent> {
  const body: unknown = await response.json().catch(() => null);
  if (isErrorEvent(body)) {
    return body;
  }
  return {
    code: response.status === 402 ? "insufficient_credits" : "request_failed",
    message:
      response.status === 402
        ? "额度不足，请充值后重试。"
        : `Generation request failed (${String(response.status)}).`,
  };
}

export function useStatueGeneration() {
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const statusBeforePauseRef = useRef<ActiveGenerationStatus>("queued");
  const latestProgressRef = useRef<GenerationProgressEvent | null>(null);
  const status = useGenerationStore((state) => state.status);
  const progress = useGenerationStore((state) => state.progress);
  const previewUrl = useGenerationStore((state) => state.previewUrl);
  const result = useGenerationStore((state) => state.result);
  const error = useGenerationStore((state) => state.error);
  const errorCode = useGenerationStore((state) => state.errorCode);
  const setQueued = useGenerationStore((state) => state.setQueued);
  const setPaused = useGenerationStore((state) => state.setPaused);
  const resume = useGenerationStore((state) => state.resume);
  const setProgress = useGenerationStore((state) => state.setProgress);
  const setComplete = useGenerationStore((state) => state.setComplete);
  const setError = useGenerationStore((state) => state.setError);
  const reset = useGenerationStore((state) => state.reset);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startGeneration = useCallback(
    async (input: StatueGenerationInput): Promise<GenerationResult | null> => {
      stopStream();
      const controller = new AbortController();
      abortRef.current = controller;
      pausedRef.current = false;
      statusBeforePauseRef.current = "queued";
      latestProgressRef.current = null;
      setQueued(input);
      const streamState: {
        completed?: GenerationResult;
        error?: GenerationErrorEvent;
      } = {};

      try {
        const response = await fetch("/api/generate/statue", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = await readGenerationHttpError(response);
          setError(error.message, error.code);
          return null;
        }

        await readSse(response, (event) => {
          if (event.event === "progress") {
            latestProgressRef.current = event.data;
            statusBeforePauseRef.current = event.data.status;
            if (!pausedRef.current) {
              setProgress(event.data);
            }
          } else if (event.event === "complete") {
            pausedRef.current = false;
            streamState.completed = event.data;
            setComplete(event.data);
          } else {
            pausedRef.current = false;
            streamState.error = event.data;
            setError(event.data.message, event.data.code);
          }
        });
        if (!streamState.completed && !streamState.error) {
          setError(
            "Generation stream ended before completion.",
            "stream_incomplete",
          );
        }
        return streamState.completed ?? null;
      } catch (error) {
        if (controller.signal.aborted) {
          return null;
        }
        setError(
          error instanceof Error ? error.message : "Generation failed.",
          "network_error",
        );
        return null;
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [setComplete, setError, setProgress, setQueued, stopStream],
  );

  const cancelGeneration = useCallback((): void => {
    stopStream();
    pausedRef.current = false;
    latestProgressRef.current = null;
    reset();
  }, [reset, stopStream]);

  useEffect(() => {
    const handleVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        const currentStatus = useGenerationStore.getState().status;
        if (!isActiveGenerationStatus(currentStatus)) {
          return;
        }
        statusBeforePauseRef.current = currentStatus;
        pausedRef.current = true;
        setPaused();
        return;
      }
      if (!pausedRef.current) {
        return;
      }
      pausedRef.current = false;
      if (latestProgressRef.current) {
        setProgress(latestProgressRef.current);
      } else {
        resume(statusBeforePauseRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopStream();
      const currentStatus = useGenerationStore.getState().status;
      if (
        isActiveGenerationStatus(currentStatus) ||
        currentStatus === "paused"
      ) {
        reset();
      }
    };
  }, [reset, resume, setPaused, setProgress, stopStream]);

  return {
    status,
    progress,
    previewUrl,
    result,
    error,
    errorCode,
    startGeneration,
    stopGeneration: cancelGeneration,
    reset,
  };
}
