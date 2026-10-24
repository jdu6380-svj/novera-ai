import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions/completions";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import type { JsonObject } from "@/domain";
import type {
  StructuredGenerationRequest,
  StructuredGenerationResult,
  LanguageModelProvider,
} from "@/providers";

import {
  getLanguageModelConfig,
  getLanguageModelIdentityConfig,
  type LanguageModelIdentityConfig,
  type OpenAILanguageModelConfig,
} from "./language-model-config";
import {
  LanguageModelProviderError,
  type LanguageModelProviderDiagnostics,
} from "./language-model-provider-error";

export interface OpenAILanguageModelClient {
  responses: {
    create(body: ResponseCreateParamsNonStreaming): Promise<Response>;
  };
}

export interface DeepSeekLanguageModelClient {
  chat: {
    completions: {
      create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
    };
  };
}

function deepSeekResponseDiagnostics(
  response: ChatCompletion,
  parseFailureReason: string,
): LanguageModelProviderDiagnostics {
  const choice = response.choices[0];
  const content = choice?.message?.content;
  return {
    requestId: response.id,
    responseFinishReason: choice?.finish_reason ?? "missing_choice",
    responseContentLength: typeof content === "string" ? content.length : 0,
    responseOutputTokens: response.usage?.completion_tokens ?? undefined,
    responseRefusal: Boolean(choice?.message?.refusal),
    responseParseFailureReason: parseFailureReason,
  };
}

export interface OpenAILanguageModelProviderDependencies {
  client?: OpenAILanguageModelClient;
}

export interface LazyOpenAILanguageModelProviderDependencies {
  createProvider?: () => LanguageModelProvider;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function providerDiagnostics(error: unknown): LanguageModelProviderDiagnostics {
  if (!error || typeof error !== "object") {
    return {};
  }

  const value = error as Record<string, unknown>;
  const nested = value.error && typeof value.error === "object"
    ? (value.error as Record<string, unknown>)
    : undefined;

  return {
    status: typeof value.status === "number" ? value.status : undefined,
    providerCode: typeof nested?.code === "string"
      ? nested.code
      : typeof value.code === "string" && value.code !== "PROVIDER_REQUEST_FAILED"
        ? value.code
        : undefined,
    providerType: typeof nested?.type === "string"
      ? nested.type
      : typeof value.type === "string"
        ? value.type
        : undefined,
    requestId: typeof value.request_id === "string"
      ? value.request_id
      : typeof value.requestID === "string"
        ? value.requestID
        : undefined,
  };
}

export class OpenAILanguageModelProvider implements LanguageModelProvider {
  readonly provider = "openai";
  readonly model: string;

  private readonly client: OpenAILanguageModelClient;
  private readonly maxOutputTokens: number;

  constructor(
    config: OpenAILanguageModelConfig,
    dependencies: OpenAILanguageModelProviderDependencies = {},
  ) {
    this.model = config.model;
    this.maxOutputTokens = config.maxOutputTokens;
    this.client =
      dependencies.client ??
      new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async generateStructured<TOutput extends JsonObject>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<TOutput>> {
    this.validateRequest(request);

    const body: ResponseCreateParamsNonStreaming = {
      model: this.model,
      instructions: request.systemPrompt,
      input: request.userPrompt,
      max_output_tokens: request.maxOutputTokens ?? this.maxOutputTokens,
      store: false,
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          schema: request.jsonSchema,
          strict: true,
        },
        verbosity: "low",
      },
    };

    let response: Response;

    try {
      response = await this.client.responses.create(body);
    } catch (error) {
      throw new LanguageModelProviderError(
        "The language model request failed.",
        "PROVIDER_REQUEST_FAILED",
        { cause: error },
        providerDiagnostics(error),
      );
    }

    if (response.error || response.status === "failed" || response.status === "incomplete") {
      throw new LanguageModelProviderError(
        "The language model returned an incomplete or failed response.",
        "INVALID_PROVIDER_RESPONSE",
        { cause: response.error ?? undefined },
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(response.output_text);
    } catch (error) {
      throw new LanguageModelProviderError(
        "The language model did not return valid JSON.",
        "INVALID_PROVIDER_RESPONSE",
        { cause: error },
      );
    }

    if (!isJsonObject(parsed)) {
      throw new LanguageModelProviderError(
        "The language model returned a JSON value instead of an object.",
        "INVALID_PROVIDER_RESPONSE",
      );
    }

    return {
      output: parsed as TOutput,
      model: this.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      providerRequestId: response.id ?? null,
    };
  }

  private validateRequest(request: StructuredGenerationRequest): void {
    if (!request.systemPrompt.trim() || !request.userPrompt.trim()) {
      throw new LanguageModelProviderError(
        "Structured generation prompts must not be blank.",
        "INVALID_INPUT",
      );
    }

    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(request.schemaName)) {
      throw new LanguageModelProviderError(
        "The structured output schema name is invalid.",
        "INVALID_INPUT",
      );
    }

    if (
      request.jsonSchema === null ||
      typeof request.jsonSchema !== "object" ||
      Array.isArray(request.jsonSchema)
    ) {
      throw new LanguageModelProviderError(
        "A JSON object schema is required for structured generation.",
        "INVALID_INPUT",
      );
    }

    if (
      request.temperature !== undefined &&
      (!Number.isFinite(request.temperature) ||
        request.temperature < 0 ||
        request.temperature > 2)
    ) {
      throw new LanguageModelProviderError(
        "temperature must be between 0 and 2.",
        "INVALID_INPUT",
      );
    }
  }
}

/**
 * DeepSeek's OpenAI-compatible Chat Completions adapter. DeepSeek currently
 * accepts JSON-object output, so schema validation remains at ClaimExtractionLayer.
 */
export class DeepSeekLanguageModelProvider implements LanguageModelProvider {
  readonly provider = "deepseek";
  readonly model: string;

  private readonly client: DeepSeekLanguageModelClient;
  private readonly maxOutputTokens: number;

  constructor(
    config: OpenAILanguageModelConfig,
    dependencies: { client?: DeepSeekLanguageModelClient } = {},
  ) {
    this.model = config.model;
    this.maxOutputTokens = config.maxOutputTokens;
    this.client =
      dependencies.client ??
      new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }) as unknown as DeepSeekLanguageModelClient;
  }

  async generateStructured<TOutput extends JsonObject>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<TOutput>> {
    validateStructuredRequest(request);

    const systemPrompt = [
      request.systemPrompt,
      "Return one valid JSON object and no markdown.",
      `The JSON object must conform to this JSON Schema: ${JSON.stringify(request.jsonSchema)}`,
    ].join("\n");
    const body: ChatCompletionCreateParamsNonStreaming & {
      thinking: { type: "disabled" };
    } = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxOutputTokens ?? this.maxOutputTokens,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };

    let response: ChatCompletion;

    try {
      response = await this.client.chat.completions.create(body);
    } catch (error) {
      throw new LanguageModelProviderError(
        "The language model request failed.",
        "PROVIDER_REQUEST_FAILED",
        { cause: error },
        providerDiagnostics(error),
      );
    }

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LanguageModelProviderError(
        "The language model returned an empty response.",
        "INVALID_PROVIDER_RESPONSE",
        undefined,
        deepSeekResponseDiagnostics(response, "empty_content"),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new LanguageModelProviderError(
        "The language model did not return valid JSON.",
        "INVALID_PROVIDER_RESPONSE",
        { cause: error },
        deepSeekResponseDiagnostics(response, "invalid_json"),
      );
    }

    if (!isJsonObject(parsed)) {
      throw new LanguageModelProviderError(
        "The language model returned a JSON value instead of an object.",
        "INVALID_PROVIDER_RESPONSE",
        undefined,
        deepSeekResponseDiagnostics(response, "non_object_json"),
      );
    }

    return {
      output: parsed as TOutput,
      model: response.model || this.model,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      providerRequestId: response.id ?? null,
    };
  }
}

function validateStructuredRequest(request: StructuredGenerationRequest): void {
  if (!request.systemPrompt.trim() || !request.userPrompt.trim()) {
    throw new LanguageModelProviderError(
      "Structured generation prompts must not be blank.",
      "INVALID_INPUT",
    );
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(request.schemaName)) {
    throw new LanguageModelProviderError(
      "The structured output schema name is invalid.",
      "INVALID_INPUT",
    );
  }

  if (
    request.jsonSchema === null ||
    typeof request.jsonSchema !== "object" ||
    Array.isArray(request.jsonSchema)
  ) {
    throw new LanguageModelProviderError(
      "A JSON object schema is required for structured generation.",
      "INVALID_INPUT",
    );
  }

  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  ) {
    throw new LanguageModelProviderError(
      "temperature must be between 0 and 2.",
      "INVALID_INPUT",
    );
  }
}

export function createOpenAILanguageModelProvider(
  config: OpenAILanguageModelConfig = getLanguageModelConfig(),
): OpenAILanguageModelProvider {
  return new OpenAILanguageModelProvider(config);
}

export function createLanguageModelProvider(
  config: OpenAILanguageModelConfig = getLanguageModelConfig(),
): LanguageModelProvider {
  if (config.provider.toLowerCase() === "deepseek") {
    return new DeepSeekLanguageModelProvider(config);
  }

  return new OpenAILanguageModelProvider(config);
}

/** Keeps status/read routes usable when OPENAI_API_KEY is not configured. */
export class LazyOpenAILanguageModelProvider implements LanguageModelProvider {
  readonly provider: string;
  readonly model: string;

  private delegate: LanguageModelProvider | undefined;
  private readonly createProvider: () => LanguageModelProvider;

  constructor(
    identity: LanguageModelIdentityConfig = getLanguageModelIdentityConfig(),
    dependencies: LazyOpenAILanguageModelProviderDependencies = {},
  ) {
    this.provider = identity.provider;
    this.model = identity.model;
    this.createProvider =
      dependencies.createProvider ?? (() => createLanguageModelProvider());
  }

  generateStructured<TOutput extends JsonObject>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<TOutput>> {
    this.delegate ??= this.createProvider();
    return this.delegate.generateStructured(request);
  }
}

export function createLazyOpenAILanguageModelProvider(
  identity: LanguageModelIdentityConfig = getLanguageModelIdentityConfig(),
): LazyOpenAILanguageModelProvider {
  return new LazyOpenAILanguageModelProvider(identity);
}
