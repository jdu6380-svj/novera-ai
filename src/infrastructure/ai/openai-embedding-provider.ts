import "server-only";

import OpenAI from "openai";
import type {
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
} from "openai/resources/embeddings";

import type { EmbeddingBatch, EmbeddingProvider } from "@/providers";

import {
  getEmbeddingConfig,
  getEmbeddingIdentityConfig,
  isDashScopeEmbedding,
  type EmbeddingIdentityConfig,
  type OpenAIEmbeddingConfig,
} from "./embedding-config";
import { EmbeddingProviderError } from "./embedding-provider-error";

export interface OpenAIEmbeddingClient {
  embeddings: {
    create(body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse>;
  };
}

export interface OpenAIEmbeddingProviderDependencies {
  client?: OpenAIEmbeddingClient;
  now?: () => Date;
}

export interface LazyOpenAIEmbeddingProviderDependencies {
  createProvider?: () => EmbeddingProvider;
}

function providerDiagnostics(error: unknown): {
  status?: number;
  providerCode?: string;
  providerType?: string;
  requestId?: string;
} {
  if (!error || typeof error !== "object") {
    return {};
  }

  const value = error as Record<string, unknown>;
  const nested = value.error && typeof value.error === "object"
    ? (value.error as Record<string, unknown>)
    : undefined;
  const status = typeof value.status === "number" ? value.status : undefined;
  const providerCode = typeof nested?.code === "string"
    ? nested.code
    : typeof value.code === "string" && value.code !== "PROVIDER_REQUEST_FAILED"
      ? value.code
      : undefined;
  const providerType = typeof nested?.type === "string" ? nested.type : undefined;
  const requestId = typeof value.request_id === "string"
    ? value.request_id
    : typeof value.requestID === "string"
      ? value.requestID
      : undefined;

  return { status, providerCode, providerType, requestId };
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;

  private readonly batchSize: number;
  private readonly supportsDimensions: boolean;
  private readonly client: OpenAIEmbeddingClient;
  private readonly now: () => Date;

  constructor(
    config: OpenAIEmbeddingConfig,
    dependencies: OpenAIEmbeddingProviderDependencies = {},
  ) {
    this.provider = config.provider;
    this.model = config.model;
    this.modelVersion = config.modelVersion;
    this.dimensions = config.dimensions;
    this.batchSize = config.batchSize;
    // DashScope's text-embedding-v1/v2 models have a fixed 1536-dimensional
    // output and reject the OpenAI `dimensions` request field. Newer
    // DashScope models and OpenAI-compatible providers support the field.
    this.supportsDimensions = !(
      isDashScopeEmbedding(config.provider, config.baseURL) &&
      /^text-embedding-v[12]$/i.test(config.model)
    );
    this.client =
      dependencies.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    this.now = dependencies.now ?? (() => new Date());
  }

  async embed(inputs: readonly string[]): Promise<EmbeddingBatch> {
    this.validateInputs(inputs);

    if (inputs.length === 0) {
      return this.createBatch([], 0);
    }

    const vectors: number[][] = [];
    let usageTokens = 0;

    for (let start = 0; start < inputs.length; start += this.batchSize) {
      const requestInputs = inputs.slice(start, start + this.batchSize);
      let response: CreateEmbeddingResponse;

      try {
        const request: EmbeddingCreateParams = {
          model: this.model,
          input: requestInputs,
          encoding_format: "float",
        };

        if (this.supportsDimensions) {
          request.dimensions = this.dimensions;
        }

        response = await this.client.embeddings.create(request);
      } catch (error) {
        throw new EmbeddingProviderError(
          "The embedding provider request failed",
          "PROVIDER_REQUEST_FAILED",
          { cause: error },
          providerDiagnostics(error),
        );
      }

      vectors.push(...this.readVectors(response, requestInputs.length));
      usageTokens += response.usage.total_tokens;
    }

    return this.createBatch(vectors, usageTokens);
  }

  private validateInputs(inputs: readonly string[]): void {
    const invalidIndex = inputs.findIndex(
      (input) => typeof input !== "string" || input.trim().length === 0,
    );

    if (invalidIndex >= 0) {
      throw new EmbeddingProviderError(
        `Embedding input at index ${invalidIndex} must contain text`,
        "INVALID_INPUT",
      );
    }
  }

  private readVectors(
    response: CreateEmbeddingResponse,
    expectedCount: number,
  ): number[][] {
    if (response.data.length !== expectedCount) {
      throw this.invalidResponse(
        `Expected ${expectedCount} embeddings but received ${response.data.length}`,
      );
    }

    const vectorsByIndex = new Map<number, number[]>();

    for (const item of response.data) {
      if (
        !Number.isSafeInteger(item.index) ||
        item.index < 0 ||
        item.index >= expectedCount ||
        vectorsByIndex.has(item.index)
      ) {
        throw this.invalidResponse(`Invalid embedding index ${item.index}`);
      }

      if (
        item.embedding.length !== this.dimensions ||
        item.embedding.some((value) => !Number.isFinite(value))
      ) {
        throw this.invalidResponse(
          `Embedding at index ${item.index} must contain ${this.dimensions} finite values`,
        );
      }

      vectorsByIndex.set(item.index, item.embedding);
    }

    return Array.from({ length: expectedCount }, (_, index) => {
      const vector = vectorsByIndex.get(index);

      if (!vector) {
        throw this.invalidResponse(`Missing embedding at index ${index}`);
      }

      return vector;
    });
  }

  private createBatch(vectors: number[][], usageTokens: number): EmbeddingBatch {
    return {
      provider: this.provider,
      model: this.model,
      modelVersion: this.modelVersion,
      dimensions: this.dimensions,
      embeddedAt: this.now().toISOString(),
      vectors,
      usageTokens,
    };
  }

  private invalidResponse(message: string): EmbeddingProviderError {
    return new EmbeddingProviderError(message, "INVALID_PROVIDER_RESPONSE");
  }
}

export function createOpenAIEmbeddingProvider(
  config: OpenAIEmbeddingConfig = getEmbeddingConfig(),
): OpenAIEmbeddingProvider {
  return new OpenAIEmbeddingProvider(config);
}

/**
 * Exposes non-secret provider identity to queue/status operations, but delays
 * API-key validation and SDK construction until embeddings are actually needed.
 */
export class LazyOpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;

  private delegate: EmbeddingProvider | undefined;
  private readonly createProvider: () => EmbeddingProvider;

  constructor(
    identity: EmbeddingIdentityConfig,
    dependencies: LazyOpenAIEmbeddingProviderDependencies = {},
  ) {
    this.provider = identity.provider;
    this.model = identity.model;
    this.modelVersion = identity.modelVersion;
    this.dimensions = identity.dimensions;
    this.createProvider = dependencies.createProvider ?? (() => createOpenAIEmbeddingProvider());
  }

  embed(inputs: readonly string[]): Promise<EmbeddingBatch> {
    this.delegate ??= this.createProvider();
    return this.delegate.embed(inputs);
  }
}

export function createLazyOpenAIEmbeddingProvider(
  identity: EmbeddingIdentityConfig = getEmbeddingIdentityConfig(),
): LazyOpenAIEmbeddingProvider {
  return new LazyOpenAIEmbeddingProvider(identity);
}
