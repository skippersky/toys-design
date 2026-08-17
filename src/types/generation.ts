import type { ImageLayer } from "@/store/editor-store";

export type GenerationTemplateId =
  "product-render" | "style-transfer" | "detail-enhance";

export interface GenerationDimensions {
  width: number;
  height: number;
}

export interface StatueGenerationInput extends GenerationDimensions {
  projectId: string;
  editorAssetId: string;
  templateId: GenerationTemplateId;
  prompt: string;
  negativePrompt?: string;
  steps: number;
  cfg: number;
  seed?: number;
  sourceImageUrl?: string;
}

export interface GenerationProgressEvent {
  task_id: string;
  prompt_id?: string;
  status: "queued" | "running" | "finalizing";
  step: number;
  total: number;
  credits_remaining?: number;
  preview_url?: string;
}

export interface GenerationResultLayer extends ImageLayer {
  asset_id: string;
}

export interface GenerationResult {
  task_id: string;
  prompt_id: string;
  project_id: string;
  asset_id: string;
  credits_remaining: number;
  preview_url: string;
  layer: GenerationResultLayer;
}

export interface GenerationErrorEvent {
  code: string;
  message: string;
}

export type GenerationSseEvent =
  | { event: "progress"; data: GenerationProgressEvent }
  | { event: "complete"; data: GenerationResult }
  | { event: "error"; data: GenerationErrorEvent };
