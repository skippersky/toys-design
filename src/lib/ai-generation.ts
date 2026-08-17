import type {
  GenerationTemplateId,
  StatueGenerationInput,
} from "@/types/generation";
import type { ComfyUIWorkflow } from "@/types/comfyui";
import { AI_RUNTIME_CONFIG } from "@/lib/ai-runtime-config";

export interface PromptTemplate {
  id: GenerationTemplateId;
  name: string;
  description: string;
  promptPrefix: string;
  negativePrompt: string;
  defaultSteps: number;
  defaultCfg: number;
  denoise: number;
}

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    id: "product-render",
    name: "产品渲染",
    description: "干净背景与商业级棚拍光线",
    promptPrefix:
      "professional collectible product render, studio lighting, clean backdrop, physically based materials",
    negativePrompt:
      "text, watermark, logo, blurry, low quality, deformed, extra limbs",
    defaultSteps: AI_RUNTIME_CONFIG.defaultSteps,
    defaultCfg: AI_RUNTIME_CONFIG.defaultCfg,
    denoise: 1,
  },
  {
    id: "style-transfer",
    name: "风格迁移",
    description: "保留主体结构并应用新的视觉风格",
    promptPrefix:
      "high fidelity style transfer, preserve subject silhouette and composition",
    negativePrompt:
      "changed composition, missing subject, text, watermark, low quality, artifacts",
    defaultSteps: AI_RUNTIME_CONFIG.defaultSteps,
    defaultCfg: AI_RUNTIME_CONFIG.defaultCfg,
    denoise: 0.65,
  },
  {
    id: "detail-enhance",
    name: "细节增强",
    description: "强化材质、边缘与微观细节",
    promptPrefix:
      "ultra detailed restoration, crisp edges, refined surface texture, realistic material detail",
    negativePrompt:
      "oversharpened, noisy, changed composition, text, watermark, low quality",
    defaultSteps: AI_RUNTIME_CONFIG.defaultSteps,
    defaultCfg: AI_RUNTIME_CONFIG.defaultCfg,
    denoise: 0.35,
  },
] as const;

export const GENERATION_DIMENSIONS = AI_RUNTIME_CONFIG.dimensions;

const MIN_STEPS = 4;
const MAX_STEPS = 30;
const MIN_CFG = 1;
const MAX_CFG = 8;
const MAX_PROMPT_LENGTH = 2_000;
const MAX_SEED = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTemplateId(value: unknown): value is GenerationTemplateId {
  return PROMPT_TEMPLATES.some((template) => template.id === value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isAllowedDimension(width: number, height: number): boolean {
  return GENERATION_DIMENSIONS.some(
    (preset) => preset.width === width && preset.height === height,
  );
}

export function getPromptTemplate(id: GenerationTemplateId): PromptTemplate {
  const template = PROMPT_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) {
    throw new Error("Unknown prompt template.");
  }
  return template;
}

export function parseGenerationInput(
  value: unknown,
): StatueGenerationInput | null {
  if (
    !isRecord(value) ||
    !isUuid(value.projectId) ||
    !isUuid(value.editorAssetId) ||
    !isTemplateId(value.templateId) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length === 0 ||
    value.prompt.length > MAX_PROMPT_LENGTH ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    !isAllowedDimension(value.width, value.height) ||
    typeof value.steps !== "number" ||
    !Number.isInteger(value.steps) ||
    value.steps < MIN_STEPS ||
    value.steps > MAX_STEPS ||
    typeof value.cfg !== "number" ||
    !Number.isFinite(value.cfg) ||
    value.cfg < MIN_CFG ||
    value.cfg > MAX_CFG ||
    (value.seed !== undefined &&
      (typeof value.seed !== "number" ||
        !Number.isInteger(value.seed) ||
        value.seed < 0 ||
        value.seed > MAX_SEED)) ||
    (value.negativePrompt !== undefined &&
      (typeof value.negativePrompt !== "string" ||
        value.negativePrompt.length > MAX_PROMPT_LENGTH)) ||
    (value.sourceImageUrl !== undefined &&
      typeof value.sourceImageUrl !== "string")
  ) {
    return null;
  }

  return {
    projectId: value.projectId,
    editorAssetId: value.editorAssetId,
    templateId: value.templateId,
    prompt: value.prompt.trim(),
    negativePrompt: value.negativePrompt?.trim() || undefined,
    width: value.width,
    height: value.height,
    steps: value.steps,
    cfg: value.cfg,
    seed: value.seed,
    sourceImageUrl: value.sourceImageUrl,
  };
}

export function createGenerationSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % (MAX_SEED + 1);
}

export function composePrompt(input: StatueGenerationInput): {
  positive: string;
  negative: string;
  denoise: number;
} {
  const template = getPromptTemplate(input.templateId);
  return {
    positive: `${template.promptPrefix}, ${input.prompt}`,
    negative: input.negativePrompt || template.negativePrompt,
    denoise: input.sourceImageUrl ? template.denoise : 1,
  };
}

export function buildComfyUIWorkflow(options: {
  input: StatueGenerationInput;
  checkpointName: string;
  seed: number;
  taskId: string;
  inputImageName?: string;
  samplerName?: string;
  scheduler?: string;
}): ComfyUIWorkflow {
  const {
    input,
    checkpointName,
    seed,
    taskId,
    inputImageName,
    samplerName = "euler",
    scheduler = "normal",
  } = options;
  const prompt = composePrompt(input);
  const latentNodeId = inputImageName ? "9" : "4";
  const workflow: ComfyUIWorkflow = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpointName },
      _meta: { title: "Load checkpoint" },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.positive, clip: ["1", 1] },
      _meta: { title: "Positive prompt" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.negative, clip: ["1", 1] },
      _meta: { title: "Negative prompt" },
    },
    "6": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: samplerName,
        scheduler,
        denoise: prompt.denoise,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: [latentNodeId, 0],
      },
      _meta: { title: "Generate" },
    },
    "7": {
      class_type: "VAEDecode",
      inputs: { samples: ["6", 0], vae: ["1", 2] },
      _meta: { title: "Decode" },
    },
    "8": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `statueforge/${taskId}`,
        images: ["7", 0],
      },
      _meta: { title: "Save result" },
    },
  };

  if (inputImageName) {
    workflow["4"] = {
      class_type: "LoadImage",
      inputs: { image: inputImageName, upload: "image" },
      _meta: { title: "Reference image" },
    };
    workflow["5"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["4", 0],
        upscale_method: "lanczos",
        width: input.width,
        height: input.height,
        crop: "disabled",
      },
      _meta: { title: "Resize reference" },
    };
    workflow["9"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["5", 0], vae: ["1", 2] },
      _meta: { title: "Encode reference" },
    };
  } else {
    workflow["4"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: input.width,
        height: input.height,
        batch_size: 1,
      },
      _meta: { title: "Empty latent" },
    };
  }

  return workflow;
}
