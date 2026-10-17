export interface RetrieverConfig {
  defaultTopK: number;
  maximumTopK: number;
  defaultSimilarityThreshold: number;
  maximumQueryCharacters: number;
}

const DEFAULT_TOP_K = 12;
const MAXIMUM_TOP_K = 50;
const DEFAULT_SIMILARITY_THRESHOLD = 0.35;
const MAXIMUM_QUERY_CHARACTERS = 4_000;

function integerSetting(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
): number {
  if (!rawValue?.trim()) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return value;
}

function unitIntervalSetting(
  name: string,
  rawValue: string | undefined,
  fallback: number,
): number {
  if (!rawValue?.trim()) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }

  return value;
}

export function getRetrieverConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RetrieverConfig {
  const maximumTopK = integerSetting(
    "RETRIEVAL_MAX_TOP_K",
    environment.RETRIEVAL_MAX_TOP_K,
    MAXIMUM_TOP_K,
    1,
  );
  const defaultTopK = integerSetting(
    "RETRIEVAL_DEFAULT_TOP_K",
    environment.RETRIEVAL_DEFAULT_TOP_K,
    DEFAULT_TOP_K,
    1,
  );

  if (defaultTopK > maximumTopK) {
    throw new Error("RETRIEVAL_DEFAULT_TOP_K must not exceed RETRIEVAL_MAX_TOP_K.");
  }

  return {
    defaultTopK,
    maximumTopK,
    defaultSimilarityThreshold: unitIntervalSetting(
      "RETRIEVAL_SIMILARITY_THRESHOLD",
      environment.RETRIEVAL_SIMILARITY_THRESHOLD,
      DEFAULT_SIMILARITY_THRESHOLD,
    ),
    maximumQueryCharacters: integerSetting(
      "RETRIEVAL_MAX_QUERY_CHARACTERS",
      environment.RETRIEVAL_MAX_QUERY_CHARACTERS,
      MAXIMUM_QUERY_CHARACTERS,
      1,
    ),
  };
}
