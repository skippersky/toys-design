export interface AiGenerationDimension {
  id: "square" | "landscape" | "portrait";
  label: string;
  width: number;
  height: number;
}

export interface AiRuntimeConfig {
  profile: string;
  defaultSteps: number;
  defaultCfg: number;
  dimensions: readonly AiGenerationDimension[];
}

export interface PublicAiRuntimeEnvironment {
  profile?: string;
  defaultSteps?: string;
  defaultCfg?: string;
  squareWidth?: string;
  squareHeight?: string;
  landscapeWidth?: string;
  landscapeHeight?: string;
  portraitWidth?: string;
  portraitHeight?: string;
}

const FALLBACK_CONFIG = {
  profile: "directml-lcm-lite",
  defaultSteps: 4,
  defaultCfg: 2,
  squareWidth: 384,
  squareHeight: 384,
  landscapeWidth: 512,
  landscapeHeight: 384,
  portraitWidth: 384,
  portraitHeight: 512,
} as const;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  multiple = 1,
): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum &&
    parsed % multiple === 0
    ? parsed
    : fallback;
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function resolveAiRuntimeConfig(
  environment: PublicAiRuntimeEnvironment,
): AiRuntimeConfig {
  const profile = environment.profile?.trim() || FALLBACK_CONFIG.profile;
  return {
    profile,
    defaultSteps: boundedInteger(
      environment.defaultSteps,
      FALLBACK_CONFIG.defaultSteps,
      4,
      30,
    ),
    defaultCfg: boundedNumber(
      environment.defaultCfg,
      FALLBACK_CONFIG.defaultCfg,
      1,
      8,
    ),
    dimensions: [
      {
        id: "square",
        label: "方形",
        width: boundedInteger(
          environment.squareWidth,
          FALLBACK_CONFIG.squareWidth,
          256,
          1536,
          8,
        ),
        height: boundedInteger(
          environment.squareHeight,
          FALLBACK_CONFIG.squareHeight,
          256,
          1536,
          8,
        ),
      },
      {
        id: "landscape",
        label: "横向",
        width: boundedInteger(
          environment.landscapeWidth,
          FALLBACK_CONFIG.landscapeWidth,
          256,
          1536,
          8,
        ),
        height: boundedInteger(
          environment.landscapeHeight,
          FALLBACK_CONFIG.landscapeHeight,
          256,
          1536,
          8,
        ),
      },
      {
        id: "portrait",
        label: "纵向",
        width: boundedInteger(
          environment.portraitWidth,
          FALLBACK_CONFIG.portraitWidth,
          256,
          1536,
          8,
        ),
        height: boundedInteger(
          environment.portraitHeight,
          FALLBACK_CONFIG.portraitHeight,
          256,
          1536,
          8,
        ),
      },
    ],
  };
}

export const AI_RUNTIME_CONFIG = resolveAiRuntimeConfig({
  profile: process.env.NEXT_PUBLIC_AI_DEPLOYMENT_PROFILE,
  defaultSteps: process.env.NEXT_PUBLIC_AI_DEFAULT_STEPS,
  defaultCfg: process.env.NEXT_PUBLIC_AI_DEFAULT_CFG,
  squareWidth: process.env.NEXT_PUBLIC_AI_SQUARE_WIDTH,
  squareHeight: process.env.NEXT_PUBLIC_AI_SQUARE_HEIGHT,
  landscapeWidth: process.env.NEXT_PUBLIC_AI_LANDSCAPE_WIDTH,
  landscapeHeight: process.env.NEXT_PUBLIC_AI_LANDSCAPE_HEIGHT,
  portraitWidth: process.env.NEXT_PUBLIC_AI_PORTRAIT_WIDTH,
  portraitHeight: process.env.NEXT_PUBLIC_AI_PORTRAIT_HEIGHT,
});
