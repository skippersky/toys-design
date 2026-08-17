"use client";

import { ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStatueGeneration } from "@/hooks/use-statue-generation";
import {
  GENERATION_DIMENSIONS,
  getPromptTemplate,
  PROMPT_TEMPLATES,
} from "@/lib/ai-generation";
import { cn } from "@/lib/utils";
import type { ImageLayer } from "@/store/editor-store";
import type {
  GenerationResult,
  GenerationTemplateId,
} from "@/types/generation";

interface AiGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editorAssetId: string;
  selectedImage?: ImageLayer;
  onGenerated: (result: GenerationResult) => void;
}

export function AiGenerationDialog({
  open,
  onOpenChange,
  projectId,
  editorAssetId,
  selectedImage,
  onGenerated,
}: AiGenerationDialogProps) {
  const [templateId, setTemplateId] =
    useState<GenerationTemplateId>("product-render");
  const initialTemplate = getPromptTemplate(templateId);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    initialTemplate.negativePrompt,
  );
  const [dimensionId, setDimensionId] = useState("square");
  const [steps, setSteps] = useState(initialTemplate.defaultSteps);
  const [cfg, setCfg] = useState(initialTemplate.defaultCfg);
  const [seed, setSeed] = useState("");
  const {
    status,
    progress,
    previewUrl,
    error,
    errorCode,
    result,
    startGeneration,
    stopGeneration,
    reset,
  } = useStatueGeneration();
  const generating =
    status === "queued" ||
    status === "running" ||
    status === "finalizing" ||
    status === "paused";
  const requiresReference = templateId !== "product-render";
  const dimensions =
    GENERATION_DIMENSIONS.find((preset) => preset.id === dimensionId) ??
    GENERATION_DIMENSIONS[0];
  const canGenerate =
    prompt.trim().length > 0 &&
    (!requiresReference || selectedImage !== undefined) &&
    !generating;
  const previewStyle = useMemo(
    () =>
      previewUrl
        ? {
            backgroundImage: `url(${JSON.stringify(previewUrl)})`,
          }
        : undefined,
    [previewUrl],
  );

  useEffect(() => {
    if (!open && !generating) {
      reset();
    }
  }, [generating, open, reset]);

  const selectTemplate = (id: GenerationTemplateId): void => {
    const template = getPromptTemplate(id);
    setTemplateId(id);
    setNegativePrompt(template.negativePrompt);
    setSteps(template.defaultSteps);
    setCfg(template.defaultCfg);
  };

  const submit = async (): Promise<void> => {
    const parsedSeed = seed.trim() ? Number(seed) : undefined;
    const generated = await startGeneration({
      projectId,
      editorAssetId,
      templateId,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      width: dimensions.width,
      height: dimensions.height,
      steps,
      cfg,
      seed:
        parsedSeed !== undefined && Number.isInteger(parsedSeed)
          ? parsedSeed
          : undefined,
      sourceImageUrl: requiresReference ? selectedImage?.src : undefined,
    });
    if (!generated) {
      return;
    }
    onGenerated(generated);
    toast.success(
      `AI 图片已添加到画布，剩余额度 ${String(generated.credits_remaining)}`,
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && generating) {
          stopGeneration();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI 生成</DialogTitle>
          <DialogDescription>
            选择工作流预设并调整生成参数。每次生成消耗 1 个额度。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium text-zinc-300">
              Prompt 模板
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PROMPT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={cn(
                    "min-h-20 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400",
                    template.id === templateId
                      ? "border-cyan-400 bg-cyan-400/10 text-zinc-50"
                      : "border-white/10 bg-zinc-950 text-zinc-400 hover:border-white/25",
                  )}
                  aria-pressed={template.id === templateId}
                  disabled={generating}
                  onClick={() => {
                    selectTemplate(template.id);
                  }}
                >
                  <span className="block text-sm font-medium">
                    {template.name}
                  </span>
                  <span className="mt-1 block text-xs leading-5">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {requiresReference ? (
            <div
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs",
                selectedImage
                  ? "border-emerald-500/30 text-emerald-300"
                  : "border-amber-500/30 text-amber-300",
              )}
              role={selectedImage ? "status" : "alert"}
            >
              <ImageIcon className="size-4" aria-hidden="true" />
              {selectedImage
                ? `参考图层：${selectedImage.name}`
                : "请先在画布或图层面板中选中一个图片图层。"}
            </div>
          ) : null}

          <label className="grid gap-2 text-xs font-medium text-zinc-300">
            自定义 Prompt
            <textarea
              value={prompt}
              maxLength={2000}
              rows={3}
              disabled={generating}
              className="min-h-24 resize-y rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm font-normal leading-6 text-zinc-100 outline-none focus:border-cyan-400"
              placeholder="描述你希望生成的主体、材质、光线和构图"
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
            />
          </label>

          <label className="grid gap-2 text-xs font-medium text-zinc-300">
            Negative Prompt
            <textarea
              value={negativePrompt}
              maxLength={2000}
              rows={2}
              disabled={generating}
              className="resize-y rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm font-normal leading-6 text-zinc-100 outline-none focus:border-cyan-400"
              onChange={(event) => {
                setNegativePrompt(event.target.value);
              }}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-[160px_1fr_1fr]">
            <label className="grid content-start gap-2 text-xs font-medium text-zinc-300">
              尺寸
              <select
                value={dimensionId}
                disabled={generating}
                className="h-9 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
                onChange={(event) => {
                  setDimensionId(event.target.value);
                }}
              >
                {GENERATION_DIMENSIONS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} {preset.width}x{preset.height}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid content-start gap-2 text-xs font-medium text-zinc-300">
              <span className="flex justify-between">
                <span>步数</span>
                <output>{steps}</output>
              </span>
              <input
                type="range"
                min={4}
                max={30}
                step={1}
                value={steps}
                disabled={generating}
                className="h-9 accent-cyan-400"
                onChange={(event) => {
                  setSteps(Number(event.target.value));
                }}
              />
            </label>

            <label className="grid content-start gap-2 text-xs font-medium text-zinc-300">
              <span className="flex justify-between">
                <span>引导系数</span>
                <output>{cfg.toFixed(1)}</output>
              </span>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={cfg}
                disabled={generating}
                className="h-9 accent-cyan-400"
                onChange={(event) => {
                  setCfg(Number(event.target.value));
                }}
              />
            </label>
          </div>

          <label className="grid max-w-52 gap-2 text-xs font-medium text-zinc-300">
            Seed（留空则随机）
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              value={seed}
              disabled={generating}
              className="h-9 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm font-normal text-zinc-100 outline-none focus:border-cyan-400"
              onChange={(event) => {
                setSeed(event.target.value);
              }}
            />
          </label>

          {generating || result ? (
            <section className="grid gap-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="capitalize">
                  {status === "paused" ? "页面后台运行中" : status}
                </span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-cyan-400 transition-[width]"
                  style={{ width: `${String(Math.round(progress * 100))}%` }}
                />
              </div>
              {previewStyle ? (
                <div
                  className="aspect-video w-full bg-zinc-950 bg-contain bg-center bg-no-repeat"
                  style={previewStyle}
                  role="img"
                  aria-label="带用户标识的 AI 生成预览"
                  data-testid="ai-generation-preview"
                />
              ) : null}
            </section>
          ) : null}

          {error ? (
            <div
              className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300"
              role="alert"
              data-error-code={errorCode}
            >
              {errorCode === "insufficient_credits"
                ? "额度不足，请充值后重试。"
                : error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (generating) {
                stopGeneration();
              } else {
                onOpenChange(false);
              }
            }}
          >
            {generating ? "停止生成" : "取消"}
          </Button>
          <Button
            type="button"
            disabled={!canGenerate}
            onClick={() => {
              void submit();
            }}
          >
            {generating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {generating ? "生成中" : "生成图片"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
