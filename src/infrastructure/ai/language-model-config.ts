import "server-only";

import { LanguageModelConfigurationError } from "./language-model-provider-error";

export const DEFAULT_LANGUAGE_MODEL_PROVIDER = "deepseek";
// DeepSeek's current OpenAI-compatible API uses deepseek-flash for generation.
export const DEFAULT_LANGUAGE_MODEL = "deepseek-flash";
export const DEFAULT_LANGUAGE_MODEL_MAX_OUTPUT_TOKENS = 1_600;
export const DEFAULT_LANGUAGE_MODEL_PROMPT_VERSION = "phase4-v1";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface LanguageModelIdentityConfig {
  provider: string;
  model: string;
  promptVersion: string;
}

export interface LanguageModelConfig extends LanguageModelIdentityConfig {
  apiKey: string;
  baseURL: string | undefined;
  maxOutputTokens: number;
}

/** @deprecated Use LanguageModelConfig. Kept for adapter compatibility. */
export type OpenAILanguageModelConfig = LanguageModelConfig;

function optionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function requiredString(name: string, value: string | undefined): string {
  const normalized = optionalString(value);

  if (!normalized) {
    throw new LanguageModelConfigurationError(`${name} is required`);
  }

  return normalized;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new LanguageModelConfigurationError(`${name} must be a positive integer`);
  }

  return parsed;
}

export function getLanguageModelIdentityConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LanguageModelIdentityConfig {
  const provider =
    optionalString(environment.LANGUAGE_MODEL_PROVIDER) ??
    DEFAULT_LANGUAGE_MODEL_PROVIDER;
  const model = optionalString(environment.LANGUAGE_MODEL) ?? DEFAULT_LANGUAGE_MODEL;

  return {
    provider,
    model,
    promptVersion:
      optionalString(environment.LANGUAGE_MODEL_PROMPT_VERSION) ??
      DEFAULT_LANGUAGE_MODEL_PROMPT_VERSION,
  };
}

export function getLanguageModelConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LanguageModelConfig {
  const identity = getLanguageModelIdentityConfig(environment);
  const isDeepSeek = identity.provider.toLowerCase() === "deepseek";
  const apiKeyName = isDeepSeek ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
  const baseURL = optionalString(
    environment[isDeepSeek ? "DEEPSEEK_BASE_URL" : "OPENAI_BASE_URL"],
  );

  return {
    ...identity,
    apiKey: requiredString(apiKeyName, environment[apiKeyName]),
    baseURL: baseURL ?? (isDeepSeek ? DEFAULT_DEEPSEEK_BASE_URL : undefined),
    maxOutputTokens: positiveInteger(
      "LANGUAGE_MODEL_MAX_OUTPUT_TOKENS",
      environment.LANGUAGE_MODEL_MAX_OUTPUT_TOKENS,
      DEFAULT_LANGUAGE_MODEL_MAX_OUTPUT_TOKENS,
    ),
  };
}
