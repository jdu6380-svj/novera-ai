export class EmbeddingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigurationError";
  }
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_INPUT"
      | "PROVIDER_REQUEST_FAILED"
      | "INVALID_PROVIDER_RESPONSE",
    options?: ErrorOptions,
    readonly diagnostics?: {
      status?: number;
      providerCode?: string;
      providerType?: string;
      requestId?: string;
    },
  ) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}
