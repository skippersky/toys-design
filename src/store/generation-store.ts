"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GenerationStatus =
  | "idle"
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "error";

export interface GenerationResultLayer {
  id: string;
  name: string;
  type: "image" | "mask" | "depth" | "metadata";
  oss_key: string;
}

export interface GenerationResult {
  asset_id: string;
  layers: GenerationResultLayer[];
}

interface GenerationState {
  status: GenerationStatus;
  progress: number;
  previewUrl?: string;
  result?: GenerationResult;
  error?: string;
  lastRequest?: StatueGenerationInput;
  setQueued: (input: StatueGenerationInput) => void;
  setPaused: () => void;
  setProgress: (progress: number, previewUrl?: string) => void;
  setComplete: (result: GenerationResult) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export interface StatueGenerationInput {
  style: "classic" | "marble" | "bronze" | "toy" | "premium";
  ratio: string;
  ip_ref_url?: string;
  prompt: string;
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
          lastRequest: input,
        }),
      setPaused: () => set({ status: "paused" }),
      setProgress: (progress, previewUrl) =>
        set({
          status: "running",
          progress,
          previewUrl,
        }),
      setComplete: (result) =>
        set({
          status: "complete",
          progress: 1,
          result,
          error: undefined,
        }),
      setError: (error) =>
        set({
          status: "error",
          error,
        }),
      reset: () =>
        set({
          status: "idle",
          progress: 0,
          previewUrl: undefined,
          result: undefined,
          error: undefined,
          lastRequest: undefined,
        }),
    }),
    {
      name: "statueforge-generation",
      partialize: (state) => ({
        status: state.status,
        progress: state.progress,
        previewUrl: state.previewUrl,
        result: state.result,
        error: state.error,
        lastRequest: state.lastRequest,
      }),
    },
  ),
);
