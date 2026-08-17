"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type {
  GenerationProgressEvent,
  GenerationResult,
  StatueGenerationInput,
} from "@/types/generation";

export type GenerationStatus =
  | "idle"
  | "queued"
  | "running"
  | "finalizing"
  | "paused"
  | "complete"
  | "error";

export type ActiveGenerationStatus = "queued" | "running" | "finalizing";

export function isActiveGenerationStatus(
  status: GenerationStatus,
): status is ActiveGenerationStatus {
  return status === "queued" || status === "running" || status === "finalizing";
}

interface GenerationState {
  status: GenerationStatus;
  progress: number;
  previewUrl?: string;
  result?: GenerationResult;
  error?: string;
  errorCode?: string;
  lastRequest?: StatueGenerationInput;
  setQueued: (input: StatueGenerationInput) => void;
  setPaused: () => void;
  resume: (status: ActiveGenerationStatus) => void;
  setProgress: (event: GenerationProgressEvent) => void;
  setComplete: (result: GenerationResult) => void;
  setError: (error: string, code?: string) => void;
  reset: () => void;
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
      status: "idle",
      progress: 0,
      setQueued: (input) =>
        set({
          status: "queued",
          progress: 0,
          previewUrl: undefined,
          result: undefined,
          error: undefined,
          errorCode: undefined,
          lastRequest: input,
        }),
      setPaused: () =>
        set((state) =>
          isActiveGenerationStatus(state.status) ? { status: "paused" } : state,
        ),
      resume: (status) =>
        set((state) => (state.status === "paused" ? { status } : state)),
      setProgress: (event) =>
        set({
          status: event.status,
          progress:
            event.total === 0
              ? 0
              : Math.min(1, Math.max(0, event.step / event.total)),
          previewUrl: event.preview_url,
        }),
      setComplete: (result) =>
        set({
          status: "complete",
          progress: 1,
          previewUrl: result.preview_url,
          result,
          error: undefined,
          errorCode: undefined,
        }),
      setError: (error, errorCode) =>
        set({
          status: "error",
          error,
          errorCode,
        }),
      reset: () =>
        set({
          status: "idle",
          progress: 0,
          previewUrl: undefined,
          result: undefined,
          error: undefined,
          errorCode: undefined,
          lastRequest: undefined,
        }),
    }),
    {
      name: "statueforge-generation",
      partialize: (state) => ({
        status:
          isActiveGenerationStatus(state.status) || state.status === "paused"
            ? "idle"
            : state.status,
        progress:
          isActiveGenerationStatus(state.status) || state.status === "paused"
            ? 0
            : state.progress,
        previewUrl: state.previewUrl,
        result: state.result,
        error: state.error,
        errorCode: state.errorCode,
        lastRequest: state.lastRequest,
      }),
      merge: (persistedState, currentState) => {
        const restored = {
          ...currentState,
          ...(persistedState && typeof persistedState === "object"
            ? persistedState
            : {}),
        };
        if (
          isActiveGenerationStatus(restored.status) ||
          restored.status === "paused"
        ) {
          return {
            ...restored,
            status: "idle",
            progress: 0,
            previewUrl: undefined,
            error: undefined,
            errorCode: undefined,
          };
        }
        return restored;
      },
    },
  ),
);
