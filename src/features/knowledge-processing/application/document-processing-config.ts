export interface DocumentProcessingConfig {
  maxAttempts: number;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CHUNK_MAX_TOKENS = 400;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 60;

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

export function getDocumentProcessingConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DocumentProcessingConfig {
  const chunkMaxTokens = integerSetting(
    "PROCESSING_CHUNK_MAX_TOKENS",
    environment.PROCESSING_CHUNK_MAX_TOKENS,
    DEFAULT_CHUNK_MAX_TOKENS,
    2,
  );
  const chunkOverlapTokens = integerSetting(
    "PROCESSING_CHUNK_OVERLAP_TOKENS",
    environment.PROCESSING_CHUNK_OVERLAP_TOKENS,
    DEFAULT_CHUNK_OVERLAP_TOKENS,
    0,
  );

  if (chunkOverlapTokens >= chunkMaxTokens) {
    throw new Error(
      "PROCESSING_CHUNK_OVERLAP_TOKENS must be smaller than PROCESSING_CHUNK_MAX_TOKENS.",
    );
  }

  return {
    maxAttempts: integerSetting(
      "PROCESSING_MAX_ATTEMPTS",
      environment.PROCESSING_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
    ),
    chunkMaxTokens,
    chunkOverlapTokens,
  };
}
