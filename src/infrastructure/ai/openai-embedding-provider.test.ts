import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CreateEmbeddingResponse } from "openai/resources/embeddings";

import type { OpenAIEmbeddingConfig } from "./embedding-config";
import { EmbeddingProviderError } from "./embedding-provider-error";
import {
  LazyOpenAIEmbeddingProvider,
  OpenAIEmbeddingProvider,
  type OpenAIEmbeddingClient,
} from "./openai-embedding-provider";
import type { EmbeddingProvider } from "@/providers";

const NOW = "2026-08-02T12:00:00.000Z";

function config(
  overrides: Partial<OpenAIEmbeddingConfig> = {},
): OpenAIEmbeddingConfig {
  return {
    provider: "openai",
    apiKey: "test-api-key",
    baseURL: undefined,
    model: "text-embedding-3-small",
    modelVersion: "deployment-2026-08-02",
    dimensions: 3,
    batchSize: 2,
    ...overrides,
  };
}

function response(
  vectors: number[][],
  totalTokens: number,
): CreateEmbeddingResponse {
  return {
    object: "list",
    model: "text-embedding-3-small",
    data: vectors.map((embedding, index) => ({
      object: "embedding",
      index,
      embedding,
    })),
    usage: {
      prompt_tokens: totalTokens,
      total_tokens: totalTokens,
    },
  };
}

function clientWith(
  create: OpenAIEmbeddingClient["embeddings"]["create"],
): OpenAIEmbeddingClient {
  return { embeddings: { create } };
}

describe("OpenAIEmbeddingProvider", () => {
  it("defers secret-dependent provider construction until embed is called", async () => {
    const createProvider = vi.fn<() => EmbeddingProvider>(() => ({
      provider: "openai",
      model: "text-embedding-3-small",
      modelVersion: "deployment-2026-08-02",
      dimensions: 1536,
      embed: async () => ({
        provider: "openai",
        model: "text-embedding-3-small",
        modelVersion: "deployment-2026-08-02",
        dimensions: 1536,
        embeddedAt: NOW,
        vectors: [],
        usageTokens: 0,
      }),
    }));
    const provider = new LazyOpenAIEmbeddingProvider(
      {
        provider: "openai",
        model: "text-embedding-3-small",
        modelVersion: "deployment-2026-08-02",
        dimensions: 1536,
      },
      { createProvider },
    );

    expect(createProvider).not.toHaveBeenCalled();
    await provider.embed([]);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("batches requests, restores provider index order, and returns auditable metadata", async () => {
    const create = vi.fn<OpenAIEmbeddingClient["embeddings"]["create"]>();
    create
      .mockResolvedValueOnce({
        ...response(
          [
            [1, 1, 1],
            [2, 2, 2],
          ],
          5,
        ),
        data: [
          { object: "embedding", index: 1, embedding: [2, 2, 2] },
          { object: "embedding", index: 0, embedding: [1, 1, 1] },
        ],
      })
      .mockResolvedValueOnce(response([[3, 3, 3]], 7));
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
      now: () => new Date(NOW),
    });

    const result = await provider.embed(["first", "second", "third"]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([request]) => request)).toEqual([
      {
        model: "text-embedding-3-small",
        input: ["first", "second"],
        dimensions: 3,
        encoding_format: "float",
      },
      {
        model: "text-embedding-3-small",
        input: ["third"],
        dimensions: 3,
        encoding_format: "float",
      },
    ]);
    expect(result).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      modelVersion: "deployment-2026-08-02",
      dimensions: 3,
      embeddedAt: NOW,
      vectors: [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
      ],
      usageTokens: 12,
    });
  });

  it("omits dimensions for DashScope text-embedding-v2", async () => {
    const create = vi.fn<OpenAIEmbeddingClient["embeddings"]["create"]>();
    create.mockResolvedValue({
      ...response([new Array(1536).fill(0)], 3),
      model: "text-embedding-v2",
    });

    const provider = new OpenAIEmbeddingProvider(
      config({
        provider: "dashscope",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "text-embedding-v2",
        modelVersion: "text-embedding-v2",
        dimensions: 1536,
      }),
      { client: clientWith(create), now: () => new Date(NOW) },
    );

    await provider.embed(["document text"]);

    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-v2",
      input: ["document text"],
      encoding_format: "float",
    });
  });

  it("returns a deterministic empty batch without calling the API", async () => {
    const create = vi.fn<OpenAIEmbeddingClient["embeddings"]["create"]>();
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
      now: () => new Date(NOW),
    });

    await expect(provider.embed([])).resolves.toMatchObject({
      vectors: [],
      usageTokens: 0,
      embeddedAt: NOW,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects empty text before calling the API", async () => {
    const create = vi.fn<OpenAIEmbeddingClient["embeddings"]["create"]>();
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
    });

    await expect(provider.embed(["valid", "   "])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("wraps SDK request failures without exposing provider-specific errors upstream", async () => {
    const providerFailure = new Error("network unavailable");
    const create = vi
      .fn<OpenAIEmbeddingClient["embeddings"]["create"]>()
      .mockRejectedValue(providerFailure);
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
    });

    try {
      await provider.embed(["text"]);
      throw new Error("Expected embedding request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingProviderError);
      expect(error).toMatchObject({
        code: "PROVIDER_REQUEST_FAILED",
        cause: providerFailure,
      });
    }
  });

  it("preserves non-secret provider diagnostics on SDK failures", async () => {
    const providerFailure = Object.assign(new Error("invalid request"), {
      status: 401,
      error: {
        code: "InvalidApiKey",
        type: "authentication_error",
      },
      request_id: "req_test_123",
    });
    const create = vi
      .fn<OpenAIEmbeddingClient["embeddings"]["create"]>()
      .mockRejectedValue(providerFailure);
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
    });

    await expect(provider.embed(["text"])).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      diagnostics: {
        status: 401,
        providerCode: "InvalidApiKey",
        providerType: "authentication_error",
        requestId: "req_test_123",
      },
    });
  });

  it("rejects malformed vectors before they can reach pgvector storage", async () => {
    const create = vi
      .fn<OpenAIEmbeddingClient["embeddings"]["create"]>()
      .mockResolvedValue(response([[1, 2]], 1));
    const provider = new OpenAIEmbeddingProvider(config(), {
      client: clientWith(create),
    });

    await expect(provider.embed(["text"])).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
});
