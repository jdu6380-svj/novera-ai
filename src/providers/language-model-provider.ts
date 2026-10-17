import type { JsonObject } from "@/domain";

export interface StructuredGenerationRequest {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  jsonSchema: JsonObject;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface StructuredGenerationResult<TOutput extends JsonObject> {
  output: TOutput;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
}

/** Provider boundary used later by the Task Understanding and Evidence workflows. */
export interface LanguageModelProvider {
  readonly model: string;

  generateStructured<TOutput extends JsonObject>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<TOutput>>;
}
