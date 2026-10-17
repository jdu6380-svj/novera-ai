import type { JsonObject } from "@/domain";
import type { LanguageModelProvider } from "@/providers";
import type { QueryUnderstandingResult } from "@/features/retrieval/application/query-understanding";
import type { BuiltPromptContext } from "@/features/retrieval/application/context-builder";
import {
  AnswerGenerationError,
  type AnswerGenerationErrorCode,
} from "./answer-generation-error";
import {
  ClaimExtractionError,
  ClaimExtractionLayer,
  SAFE_INSUFFICIENT_EVIDENCE_ANSWER,
} from "./claim-extraction";
import type { AnswerGeneratorResult } from "@/features/qa/domain/qa";

const ANSWER_SCHEMA_NAME = "novera_traceable_answer";

export const TRACEABLE_ANSWER_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "claims", "limitations", "insufficient_evidence"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 12_000 },
    claims: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim_text", "claim_type", "weight", "evidence"],
        properties: {
          claim_text: { type: "string", minLength: 1, maxLength: 2_000 },
          claim_type: {
            type: "string",
            enum: ["fact", "analysis", "comparison", "recommendation"],
          },
          weight: { type: "number", minimum: 0.1, maximum: 10 },
          evidence: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["citation_label", "quote"],
              properties: {
                citation_label: { type: "string", pattern: "^\\[S\\d+\\]$" },
                quote: { type: "string", minLength: 1, maxLength: 2_000 },
              },
            },
          },
        },
      },
    },
    limitations: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    insufficient_evidence: { type: "boolean" },
  },
};

export interface AnswerGeneratorInput {
  query: string;
  taskUnderstanding: QueryUnderstandingResult;
  context: BuiltPromptContext;
}

function buildSystemPrompt(): string {
  return [
    "You are Novera AI's Evidence Intelligence Answer Generator.",
    "Answer only from the bounded knowledge context supplied by the application.",
    "Return JSON matching the supplied schema; never return markdown or free text outside that JSON.",
    "Every material claim must include one or more citation_label values that exist in the context.",
    "Every quote must be copied exactly from the cited source content, preserving punctuation and wording.",
    "If the context is insufficient, set insufficient_evidence=true, keep claims limited to supported facts, and explain the limitation.",
    "Do not invent documents, identifiers, metrics, dates, or citations.",
  ].join("\n");
}

function buildUserPrompt(input: AnswerGeneratorInput): string {
  return [
    `Task type: ${input.taskUnderstanding.understoodTaskType}`,
    `Task confidence: ${input.taskUnderstanding.confidence}`,
    `User query: ${input.query}`,
    "",
    "Bounded knowledge context:",
    input.context.context || "(No relevant knowledge was retrieved.)",
  ].join("\n");
}

function throwGenerationError(error: unknown): never {
  if (error instanceof AnswerGenerationError) {
    throw error;
  }

  if (error instanceof ClaimExtractionError) {
    throw new AnswerGenerationError(
      "The model output did not satisfy the traceable answer contract.",
      "INVALID_GENERATED_ANSWER",
      { cause: error },
    );
  }

  throw new AnswerGenerationError(
    "The answer could not be generated from the retrieved knowledge.",
    "MODEL_GENERATION_FAILED",
    { cause: error },
  );
}

export class AnswerGenerator {
  constructor(
    private readonly provider: LanguageModelProvider,
    private readonly claimExtraction: ClaimExtractionLayer = new ClaimExtractionLayer(),
    private readonly promptVersion = "phase4-v1",
  ) {}

  async generate(input: AnswerGeneratorInput): Promise<AnswerGeneratorResult> {
    if (!input.query.trim()) {
      throw new AnswerGenerationError(
        "A non-empty query is required for answer generation.",
        "INVALID_GENERATED_ANSWER",
      );
    }

    if (input.context.chunks.length === 0) {
      return {
        structuredAnswer: {
          answer: SAFE_INSUFFICIENT_EVIDENCE_ANSWER,
          claims: [],
          limitations: ["本次检索没有返回达到阈值的知识片段。"],
          insufficientEvidence: true,
        },
        model: null,
        promptVersion: this.promptVersion,
        inputTokens: null,
        outputTokens: null,
        providerRequestId: null,
      };
    }

    try {
      const result = await this.provider.generateStructured<JsonObject>({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(input),
        schemaName: ANSWER_SCHEMA_NAME,
        jsonSchema: TRACEABLE_ANSWER_JSON_SCHEMA,
        maxOutputTokens: undefined,
      });

      return {
        structuredAnswer: this.claimExtraction.extract(result.output),
        model: result.model,
        promptVersion: this.promptVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        providerRequestId: result.providerRequestId,
      };
    } catch (error) {
      throwGenerationError(error);
    }
  }
}

export function answerGenerationErrorCode(error: unknown): AnswerGenerationErrorCode {
  return error instanceof AnswerGenerationError
    ? error.code
    : "MODEL_GENERATION_FAILED";
}
