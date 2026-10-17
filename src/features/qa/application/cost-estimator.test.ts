import { describe, expect, it } from "vitest";

import { estimateQaRunCost } from "./cost-estimator";

describe("estimateQaRunCost", () => {
  it("combines embedding and generation usage with explicit rates", () => {
    expect(
      estimateQaRunCost(
        {
          queryEmbeddingTokens: 100,
          generationInputTokens: 1_000,
          generationOutputTokens: 500,
        },
        {
          EMBEDDING_INPUT_COST_USD_PER_1M_TOKENS: "0.02",
          LANGUAGE_MODEL_INPUT_COST_USD_PER_1M_TOKENS: "0.25",
          LANGUAGE_MODEL_OUTPUT_COST_USD_PER_1M_TOKENS: "2",
          LANGUAGE_MODEL_PROVIDER: "openai",
          QA_COST_PRICING_SOURCE: "test-pricing",
        },
      ),
    ).toMatchObject({
      estimatedCostUsd: 0.001252,
      pricingSource: "test-pricing",
    });
  });

  it("returns null when providers do not report any usage", () => {
    expect(
      estimateQaRunCost({
        queryEmbeddingTokens: null,
        generationInputTokens: null,
        generationOutputTokens: null,
      }).estimatedCostUsd,
    ).toBeNull();
  });
});
