export const DEFAULT_QA_PRICING = {
  embeddingInputUsdPerMillionTokens: 0.02,
  languageInputUsdPerMillionTokens: 0.3,
  languageOutputUsdPerMillionTokens: 1.2,
  source: "deepseek-flash-peak-cache-miss-2026-09-23",
} as const;

const OPENAI_QA_PRICING = {
  languageInputUsdPerMillionTokens: 0.25,
  languageOutputUsdPerMillionTokens: 2,
  source: "openai-list-price-2026-09-03",
} as const;

export interface QaRunCostInput {
  queryEmbeddingTokens: number | null;
  generationInputTokens: number | null;
  generationOutputTokens: number | null;
}

export interface QaRunCostEstimate {
  estimatedCostUsd: number | null;
  pricingSource: string;
  ratesUsdPerMillionTokens: {
    embeddingInput: number;
    languageInput: number;
    languageOutput: number;
  };
}

function nonNegativeRate(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) return fallback;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

function tokenCost(tokens: number | null, rate: number): number | null {
  return tokens === null ? null : (tokens / 1_000_000) * rate;
}

/** Produces an explicit estimate; environment overrides keep pricing assumptions auditable. */
export function estimateQaRunCost(
  input: QaRunCostInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): QaRunCostEstimate {
  const provider = environment.LANGUAGE_MODEL_PROVIDER?.trim().toLowerCase() || "deepseek";
  const providerPricing = provider === "openai" ? OPENAI_QA_PRICING : DEFAULT_QA_PRICING;
  const rates = {
    embeddingInput: nonNegativeRate(
      "EMBEDDING_INPUT_COST_USD_PER_1M_TOKENS",
      environment.EMBEDDING_INPUT_COST_USD_PER_1M_TOKENS,
      DEFAULT_QA_PRICING.embeddingInputUsdPerMillionTokens,
    ),
    languageInput: nonNegativeRate(
      "LANGUAGE_MODEL_INPUT_COST_USD_PER_1M_TOKENS",
      environment.LANGUAGE_MODEL_INPUT_COST_USD_PER_1M_TOKENS,
      providerPricing.languageInputUsdPerMillionTokens,
    ),
    languageOutput: nonNegativeRate(
      "LANGUAGE_MODEL_OUTPUT_COST_USD_PER_1M_TOKENS",
      environment.LANGUAGE_MODEL_OUTPUT_COST_USD_PER_1M_TOKENS,
      providerPricing.languageOutputUsdPerMillionTokens,
    ),
  };
  const components = [
    tokenCost(input.queryEmbeddingTokens, rates.embeddingInput),
    tokenCost(input.generationInputTokens, rates.languageInput),
    tokenCost(input.generationOutputTokens, rates.languageOutput),
  ];
  const knownComponents = components.filter((value): value is number => value !== null);

  return {
    estimatedCostUsd:
      knownComponents.length === 0
        ? null
        : Number(knownComponents.reduce((sum, value) => sum + value, 0).toFixed(8)),
    pricingSource:
      environment.QA_COST_PRICING_SOURCE?.trim() || providerPricing.source,
    ratesUsdPerMillionTokens: rates,
  };
}
