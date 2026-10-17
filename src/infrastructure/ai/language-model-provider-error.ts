export type LanguageModelProviderErrorCode =
  | "INVALID_INPUT"
  | "CONFIGURATION_ERROR"
  | "PROVIDER_REQUEST_FAILED"
  | "INVALID_PROVIDER_RESPONSE";

export interface LanguageModelProviderDiagnostics {
  status?: number;
  providerCode?: string;
  providerType?: string;
  requestId?: string;
}

export class LanguageModelProviderError extends Error {
  constructor(
    message: string,
    readonly code: LanguageModelProviderErrorCode,
    options?: ErrorOptions,
    readonly diagnostics?: LanguageModelProviderDiagnostics,
  ) {
    super(message, options);
    this.name = "LanguageModelProviderError";
  }
}

export class LanguageModelConfigurationError extends LanguageModelProviderError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR");
    this.name = "LanguageModelConfigurationError";
  }
}
