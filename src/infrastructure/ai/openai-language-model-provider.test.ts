import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions/completions";

import type { LanguageModelProvider } from "@/providers";
import type { JsonObject } from "@/domain";
import type { OpenAILanguageModelConfig } from "./language-model-config";
import {
  LazyOpenAILanguageModelProvider,
  OpenAILanguageModelProvider,
  DeepSeekLanguageModelProvider,
  type OpenAILanguageModelClient,
  type DeepSeekLanguageModelClient,
} from "./openai-language-model-provider";

const NOW_CONFIG: OpenAILanguageModelConfig = {
  provider: "openai",
  model: "gpt-5-mini",
  promptVersion: "phase4-v1",
  apiKey: "test-key",
  baseURL: undefined,
  maxOutputTokens: 400,
};

function response(outputText: string): Response {
  return {
    id: "resp_test_123",
    created_at: 1,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5-mini",
    object: "response",
    output: [],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage: {
      input_tokens: 11,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 18,
    },
  } as unknown as Response;
}

function clientWith(create: OpenAILanguageModelClient["responses"]["create"]): OpenAILanguageModelClient {
  return { responses: { create } };
}

function deepSeekClientWith(
  create: DeepSeekLanguageModelClient["chat"]["completions"]["create"],
): DeepSeekLanguageModelClient {
  return { chat: { completions: { create } } };
}

function chatResponse(content: string): ChatCompletion {
  return {
    id: "chatcmpl_test_123",
    object: "chat.completion",
    created: 1,
    model: "deepseek-flash",
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content, refusal: null, annotations: [] },
    }],
    usage: { prompt_tokens: 13, completion_tokens: 8, total_tokens: 21 },
  } as unknown as ChatCompletion;
}

describe("OpenAILanguageModelProvider", () => {
  it("uses Responses structured outputs and returns auditable usage metadata", async () => {
    const create = vi
      .fn<OpenAILanguageModelClient["responses"]["create"]>()
      .mockResolvedValue(response('{"answer":"supported"}'));
    const provider = new OpenAILanguageModelProvider(NOW_CONFIG, { client: clientWith(create) });

    const result = await provider.generateStructured({
      systemPrompt: "Return the answer contract.",
      userPrompt: "Use only source S1.",
      schemaName: "answer_contract",
      jsonSchema: { type: "object", additionalProperties: false },
    });

    const request = create.mock.calls[0]?.[0] as ResponseCreateParamsNonStreaming;
    expect(request).toMatchObject({
      model: "gpt-5-mini",
      instructions: "Return the answer contract.",
      input: "Use only source S1.",
      max_output_tokens: 400,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "answer_contract",
          strict: true,
        },
        verbosity: "low",
      },
    });
    expect(result).toEqual({
      output: { answer: "supported" },
      model: "gpt-5-mini",
      inputTokens: 11,
      outputTokens: 7,
      providerRequestId: "resp_test_123",
    });
  });

  it("rejects non-JSON and provider failures at the adapter boundary", async () => {
    const malformed = new OpenAILanguageModelProvider(NOW_CONFIG, {
      client: clientWith(vi.fn().mockResolvedValue(response("not-json"))),
    });
    await expect(
      malformed.generateStructured({
        systemPrompt: "system",
        userPrompt: "user",
        schemaName: "schema",
        jsonSchema: { type: "object" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });

    const failure = new Error("offline");
    const failed = new OpenAILanguageModelProvider(NOW_CONFIG, {
      client: clientWith(vi.fn().mockRejectedValue(failure)),
    });
    await expect(
      failed.generateStructured({
        systemPrompt: "system",
        userPrompt: "user",
        schemaName: "schema",
        jsonSchema: { type: "object" },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_REQUEST_FAILED", cause: failure });
  });

  it("preserves non-secret provider diagnostics on SDK failures", async () => {
    const failure = Object.assign(new Error("bad request"), {
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      request_id: "req_test_123",
    });
    const provider = new OpenAILanguageModelProvider(NOW_CONFIG, {
      client: clientWith(vi.fn().mockRejectedValue(failure)),
    });

    await expect(provider.generateStructured({
      systemPrompt: "system",
      userPrompt: "user",
      schemaName: "schema",
      jsonSchema: { type: "object" },
    })).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      diagnostics: {
        status: 400,
        providerCode: "invalid_request_error",
        providerType: "invalid_request_error",
        requestId: "req_test_123",
      },
    });
  });

  it("keeps API-key construction lazy", async () => {
    const createProvider = vi.fn<() => LanguageModelProvider>(() => ({
      model: "fake-model",
      generateStructured: async <TOutput extends JsonObject>() => ({
        output: { ok: true } as unknown as TOutput,
        model: "fake-model",
        inputTokens: null,
        outputTokens: null,
        providerRequestId: null,
      }),
    }));
    const provider = new LazyOpenAILanguageModelProvider(
      { provider: "openai", model: "fake-model", promptVersion: "test" },
      { createProvider },
    );

    expect(createProvider).not.toHaveBeenCalled();
    await provider.generateStructured({
      systemPrompt: "system",
      userPrompt: "user",
      schemaName: "schema",
      jsonSchema: { type: "object" },
    });
    expect(createProvider).toHaveBeenCalledTimes(1);
  });
});

describe("DeepSeekLanguageModelProvider", () => {
  it("requests JSON mode and returns parsed output with usage metadata", async () => {
    const create = vi
      .fn<DeepSeekLanguageModelClient["chat"]["completions"]["create"]>()
      .mockResolvedValue(chatResponse('{"answer":"supported"}'));
    const provider = new DeepSeekLanguageModelProvider(
      { ...NOW_CONFIG, provider: "deepseek", model: "deepseek-flash" },
      { client: deepSeekClientWith(create) },
    );

    const result = await provider.generateStructured({
      systemPrompt: "Use only the bounded source.",
      userPrompt: "Question",
      schemaName: "answer_contract",
      jsonSchema: { type: "object", additionalProperties: false },
    });

    const request = create.mock.calls[0]?.[0] as ChatCompletionCreateParamsNonStreaming;
    expect(request).toMatchObject({
      model: "deepseek-flash",
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: expect.stringContaining('"additionalProperties":false') },
        { role: "user", content: "Question" },
      ],
    });
    expect(result).toEqual({
      output: { answer: "supported" },
      model: "deepseek-flash",
      inputTokens: 13,
      outputTokens: 8,
      providerRequestId: "chatcmpl_test_123",
    });
  });

  it("rejects malformed provider JSON", async () => {
    const provider = new DeepSeekLanguageModelProvider(
      { ...NOW_CONFIG, provider: "deepseek" },
      { client: deepSeekClientWith(vi.fn().mockResolvedValue(chatResponse("not-json"))) },
    );
    await expect(provider.generateStructured({
      systemPrompt: "system",
      userPrompt: "user",
      schemaName: "schema",
      jsonSchema: { type: "object" },
    })).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});
