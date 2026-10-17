import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_PROVIDER,
  getEmbeddingConfig,
  getEmbeddingIdentityConfig,
} from "./embedding-config";
import { EmbeddingConfigurationError } from "./embedding-provider-error";

describe("getEmbeddingConfig", () => {
  it("exposes queue-safe provider identity without requiring an API secret", () => {
    expect(getEmbeddingIdentityConfig({})).toEqual({
      provider: DEFAULT_EMBEDDING_PROVIDER,
      model: DEFAULT_EMBEDDING_MODEL,
      modelVersion: DEFAULT_EMBEDDING_MODEL,
      dimensions: 1536,
    });
  });

  it("uses pgvector-safe defaults and treats the model ID as the default audit version", () => {
    expect(DEFAULT_EMBEDDING_BATCH_SIZE).toBe(10);
    expect(
      getEmbeddingConfig({
        OPENAI_API_KEY: " test-api-key ",
      }),
    ).toEqual({
      provider: DEFAULT_EMBEDDING_PROVIDER,
      apiKey: "test-api-key",
      baseURL: undefined,
      model: DEFAULT_EMBEDDING_MODEL,
      modelVersion: DEFAULT_EMBEDDING_MODEL,
      dimensions: 1536,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    });
  });

  it("prefers the dedicated embedding key while retaining the legacy fallback", () => {
    expect(
      getEmbeddingConfig({
        EMBEDDING_API_KEY: "embedding-secret",
        OPENAI_API_KEY: "legacy-secret",
      }).apiKey,
    ).toBe("embedding-secret");
    expect(getEmbeddingConfig({ OPENAI_API_KEY: "legacy-secret" }).apiKey).toBe(
      "legacy-secret",
    );
  });

  it("reads explicit provider, endpoint, model revision, dimension, and batch settings", () => {
    expect(
      getEmbeddingConfig({
        OPENAI_API_KEY: "secret",
        OPENAI_BASE_URL: " https://embeddings.example.test/v1 ",
        EMBEDDING_PROVIDER: "openai-compatible",
        EMBEDDING_MODEL: "custom-embedding-model",
        EMBEDDING_MODEL_VERSION: "deployment-2026-08-02",
        EMBEDDING_DIMENSION: "1536",
        EMBEDDING_BATCH_SIZE: "24",
      }),
    ).toEqual({
      provider: "openai-compatible",
      apiKey: "secret",
      baseURL: "https://embeddings.example.test/v1",
      model: "custom-embedding-model",
      modelVersion: "deployment-2026-08-02",
      dimensions: 1536,
      batchSize: 24,
    });
  });

  it("caps DashScope-compatible batches without changing the environment setting", () => {
    expect(
      getEmbeddingConfig({
        EMBEDDING_API_KEY: "secret",
        EMBEDDING_PROVIDER: "openai-compatible",
        EMBEDDING_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        EMBEDDING_BATCH_SIZE: "100",
      }).batchSize,
    ).toBe(10);
  });

  it("uses DashScope text-embedding-v2's 25-item batch limit", () => {
    expect(
      getEmbeddingConfig({
        EMBEDDING_API_KEY: "secret",
        EMBEDDING_PROVIDER: "dashscope",
        EMBEDDING_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        EMBEDDING_MODEL: "text-embedding-v2",
        EMBEDDING_BATCH_SIZE: "100",
      }).batchSize,
    ).toBe(25);
  });

  it("requires a server-side API key", () => {
    expect(() => getEmbeddingConfig({})).toThrowError(EmbeddingConfigurationError);
    expect(() => getEmbeddingConfig({})).toThrow("EMBEDDING_API_KEY is required");
  });

  it("rejects dimensions that do not match the pgvector schema", () => {
    expect(() =>
      getEmbeddingConfig({
        OPENAI_API_KEY: "secret",
        EMBEDDING_DIMENSION: "3072",
      }),
    ).toThrow("must match the pgvector schema dimension (1536)");
  });

  it("rejects invalid batch sizes", () => {
    expect(() =>
      getEmbeddingConfig({
        OPENAI_API_KEY: "secret",
        EMBEDDING_BATCH_SIZE: "0",
      }),
    ).toThrow("EMBEDDING_BATCH_SIZE must be a positive integer");
  });
});
