import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_LANGUAGE_MODEL,
  DEFAULT_LANGUAGE_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_LANGUAGE_MODEL_PROMPT_VERSION,
  DEFAULT_LANGUAGE_MODEL_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  getLanguageModelConfig,
  getLanguageModelIdentityConfig,
} from "./language-model-config";
import { LanguageModelConfigurationError } from "./language-model-provider-error";

describe("getLanguageModelConfig", () => {
  it("exposes a provider identity without requiring the API secret", () => {
    expect(getLanguageModelIdentityConfig({})).toEqual({
      provider: DEFAULT_LANGUAGE_MODEL_PROVIDER,
      model: DEFAULT_LANGUAGE_MODEL,
      promptVersion: DEFAULT_LANGUAGE_MODEL_PROMPT_VERSION,
    });
  });

  it("defaults to the selected DeepSeek provider and current model", () => {
    expect(DEFAULT_LANGUAGE_MODEL_PROVIDER).toBe("deepseek");
    expect(DEFAULT_LANGUAGE_MODEL).toBe("deepseek-chat");
    expect(getLanguageModelConfig({ DEEPSEEK_API_KEY: " test-key " })).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      promptVersion: DEFAULT_LANGUAGE_MODEL_PROMPT_VERSION,
      apiKey: "test-key",
      baseURL: DEFAULT_DEEPSEEK_BASE_URL,
      maxOutputTokens: DEFAULT_LANGUAGE_MODEL_MAX_OUTPUT_TOKENS,
    });
  });

  it("accepts an explicit compatible endpoint and model deployment", () => {
    expect(
      getLanguageModelConfig({
        LANGUAGE_MODEL_PROVIDER: "openai-compatible",
        OPENAI_API_KEY: "secret",
        OPENAI_BASE_URL: " https://models.example.test/v1 ",
        LANGUAGE_MODEL: "enterprise-answer-model",
        LANGUAGE_MODEL_PROMPT_VERSION: "phase6-demo-v1",
        LANGUAGE_MODEL_MAX_OUTPUT_TOKENS: "2400",
      }),
    ).toEqual({
      provider: "openai-compatible",
      model: "enterprise-answer-model",
      promptVersion: "phase6-demo-v1",
      apiKey: "secret",
      baseURL: "https://models.example.test/v1",
      maxOutputTokens: 2400,
    });
  });

  it("requires the server-side API key and rejects invalid token limits", () => {
    expect(() => getLanguageModelConfig({})).toThrowError(
      LanguageModelConfigurationError,
    );
    expect(() => getLanguageModelConfig({})).toThrow("DEEPSEEK_API_KEY is required");
    expect(() =>
      getLanguageModelConfig({
        LANGUAGE_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "secret",
        LANGUAGE_MODEL_MAX_OUTPUT_TOKENS: "0",
      }),
    ).toThrow("LANGUAGE_MODEL_MAX_OUTPUT_TOKENS must be a positive integer");
  });

  it("uses the DeepSeek credential and endpoint for DeepSeek generation", () => {
    expect(
      getLanguageModelConfig({
        LANGUAGE_MODEL_PROVIDER: "deepseek",
        LANGUAGE_MODEL: "deepseek-flash",
        DEEPSEEK_API_KEY: " deepseek-secret ",
      }),
    ).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "deepseek-secret",
      baseURL: DEFAULT_DEEPSEEK_BASE_URL,
    });
    expect(() =>
      getLanguageModelConfig({ LANGUAGE_MODEL_PROVIDER: "deepseek" }),
    ).toThrow("DEEPSEEK_API_KEY is required");
  });
});
