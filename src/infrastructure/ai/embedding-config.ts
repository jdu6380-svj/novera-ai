import "server-only";

import { EMBEDDING_DIMENSION } from "@/domain";

import { EmbeddingConfigurationError } from "./embedding-provider-error";

export const DEFAULT_EMBEDDING_PROVIDER = "openai";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
// Keep the default conservative for OpenAI-compatible providers. DashScope
// model-specific limits are applied below so text-embedding-v2 can use its
// documented 25-item request limit while v3/v4 stay at 10.
export const DEFAULT_EMBEDDING_BATCH_SIZE = 10;
const DASHSCOPE_DEFAULT_MAX_EMBEDDING_BATCH_SIZE = 10;

export interface EmbeddingIdentityConfig {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
}

export interface OpenAIEmbeddingConfig extends EmbeddingIdentityConfig {
  apiKey: string;
  baseURL: string | undefined;
  batchSize: number;
}

function requiredString(name: string, value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new EmbeddingConfigurationError(`${name} is required`);
  }

  return normalized;
}

function optionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function isDashScopeEmbedding(
  provider: string,
  baseURL: string | undefined,
): boolean {
  const providerValue = provider.toLocaleLowerCase("en-US");
  const baseURLValue = baseURL?.toLocaleLowerCase("en-US") ?? "";

  return (
    providerValue.includes("dashscope") ||
    baseURLValue.includes("dashscope.com") ||
    baseURLValue.includes("aliyuncs.com")
  );
}

function dashScopeMaxEmbeddingBatchSize(model: string): number {
  return /^text-embedding-v[12]$/i.test(model)
    ? 25
    : DASHSCOPE_DEFAULT_MAX_EMBEDDING_BATCH_SIZE;
}

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new EmbeddingConfigurationError(`${name} must be a positive integer`);
  }

  return parsed;
}

/**
 * Reads server-only embedding configuration and fails fast on vector-schema drift.
 * `modelVersion` is an application-managed audit label because embedding responses
 * expose a model identifier but not a separately immutable model revision.
 */
export function getEmbeddingIdentityConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): EmbeddingIdentityConfig {
  const model = optionalString(environment.EMBEDDING_MODEL) ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = positiveInteger(
    "EMBEDDING_DIMENSION",
    environment.EMBEDDING_DIMENSION,
    EMBEDDING_DIMENSION,
  );

  if (dimensions !== EMBEDDING_DIMENSION) {
    throw new EmbeddingConfigurationError(
      `EMBEDDING_DIMENSION must match the pgvector schema dimension (${EMBEDDING_DIMENSION})`,
    );
  }

  return {
    provider:
      optionalString(environment.EMBEDDING_PROVIDER) ?? DEFAULT_EMBEDDING_PROVIDER,
    model,
    modelVersion: optionalString(environment.EMBEDDING_MODEL_VERSION) ?? model,
    dimensions,
  };
}

export function getEmbeddingConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OpenAIEmbeddingConfig {
  const apiKey = requiredString(
    "EMBEDDING_API_KEY",
    environment.EMBEDDING_API_KEY ?? environment.OPENAI_API_KEY,
  );

  const identity = getEmbeddingIdentityConfig(environment);
  const baseURL = optionalString(
    environment.EMBEDDING_BASE_URL ?? environment.OPENAI_BASE_URL,
  );
  const configuredBatchSize = positiveInteger(
    "EMBEDDING_BATCH_SIZE",
    environment.EMBEDDING_BATCH_SIZE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
  );
  const batchSize = isDashScopeEmbedding(identity.provider, baseURL)
    ? Math.min(configuredBatchSize, dashScopeMaxEmbeddingBatchSize(identity.model))
    : configuredBatchSize;

  return {
    ...identity,
    apiKey,
    baseURL,
    batchSize,
  };
}
