"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  type GenerationResult,
  type StatueGenerationInput,
  useGenerationStore,
} from "@/store/generation-store";

interface ProgressEventData {
  step: number;
  total: number;
  preview_url?: string;
}

interface ErrorEventData {
  code: string;
  message: string;
}

type SseEvent =
  | { event: "progress"; data: ProgressEventData }
  | { event: "complete"; data: GenerationResult }
  | { event: "error"; data: ErrorEventData };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGenerationResult(value: unknown): value is GenerationResult {
  if (!isRecord(value) || typeof value.asset_id !== "string") {
    return false;
  }

  return (
    Array.isArray(value.layers) &&
    value.layers.every(
      (layer) =>
        isRecord(layer) &&
        typeof layer.id === "string" &&
        typeof layer.name === "string" &&
        typeof layer.oss_key === "string" &&
        (layer.type === "image" ||
          layer.type === "mask" ||
          layer.type === "depth" ||
          layer.type === "metadata"),
    )
  );
}

function parseSseBlock(block: string): SseEvent | null {
  const event = block
    .split("\n")
    .find((line) => line.startsWith("event: "))
    ?.slice("event: ".length);
  const dataLine = block
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);

  if (!event || !dataLine) {
    return null;
  }

  const data: unknown = JSON.parse(dataLine);

  if (
    event === "progress" &&
    isRecord(data) &&
    typeof data.step === "number" &&
    typeof data.total === "number"
  ) {
    return {
      event,
      data: {
        step: data.step,
        total: data.total,
        preview_url:
          typeof data.preview_url === "string" ? data.preview_url : undefined,
      },
    };
  }

  if (event === "complete" && isGenerationResult(data)) {
    return {
      event,
      data,
    };
  }

  if (
    event === "error" &&
    isRecord(data) &&
    typeof data.code === "string" &&
    typeof data.message === "string"
  ) {
    return {
      event,
      data: {
        code: data.code,
        message: data.message,
      },
    };
  }

  return null;
}

async function readSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
) {
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
    buffer += decoder.decode(chunk.value, { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseBlock(block);
      if (event) {
        onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function useStatueGeneration() {
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const latestProgressRef = useRef<{
    progress: number;
    previewUrl?: string;
  } | null>(null);
  const store = useGenerationStore();

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startGeneration = useCallback(
    async (input: StatueGenerationInput) => {
      stopStream();
      const controller = new AbortController();
      abortRef.current = controller;
      store.setQueued(input);

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
          const message = await response.text();
          throw new Error(message || "Generation request failed.");
        }

        await readSse(response, (event) => {
          if (event.event === "progress") {
            const progress =
              event.data.total === 0 ? 0 : event.data.step / event.data.total;
            latestProgressRef.current = {
              progress,
              previewUrl: event.data.preview_url,
            };

            if (!pausedRef.current) {
              store.setProgress(progress, event.data.preview_url);
            }
          }

          if (event.event === "complete") {
            pausedRef.current = false;
            store.setComplete(event.data);
          }

          if (event.event === "error") {
            pausedRef.current = false;
            store.setError(event.data.message);
          }
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        store.setError(
          error instanceof Error ? error.message : "Generation failed.",
        );
      }
    },
    [stopStream, store],
  );

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        pausedRef.current = true;
        store.setPaused();
        return;
      }

      pausedRef.current = false;
      if (latestProgressRef.current) {
        store.setProgress(
          latestProgressRef.current.progress,
          latestProgressRef.current.previewUrl,
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopStream();
    };
  }, [stopStream, store]);

  return {
    status: store.status,
    progress: store.progress,
    previewUrl: store.previewUrl,
    result: store.result,
    error: store.error,
    startGeneration,
  };
}
