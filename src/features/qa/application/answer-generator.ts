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
const VISUAL_QUERY_PATTERN = /图表|图像|图片|截图|图中|chart|graph|image|figure|scanned\s+page/iu;
const VISUAL_SOURCE_REVIEW_ANSWER = "没有检索到可核验的图表或图像来源，暂不报告其中的数值。请完成 OCR 或人工复核后再提问。";

function hasVerifiedVisualEvidence(chunks: BuiltPromptContext["chunks"]): boolean {
  return chunks.some((chunk) => {
    const metadata = chunk.metadata;
    const evidence = metadata.evidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
    const sourceSegments = (evidence as Record<string, unknown>).sourceSegments;
    if (!Array.isArray(sourceSegments)) return false;
    return sourceSegments.some((segment) => {
      if (!segment || typeof segment !== "object" || Array.isArray(segment)) return false;
      const sourceMetadata = (segment as Record<string, unknown>).metadata;
      if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) return false;
      const source = sourceMetadata as Record<string, unknown>;
      return source.extractionMethod === "tesseract-ocr" &&
        typeof source.confidence === "number" &&
        source.confidence >= 90;
    });
  });
}

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
  visualEvidenceRequired?: boolean;
}

function buildSystemPrompt(): string {
  return [
    "You are Novera AI's Evidence Intelligence Answer Generator.",
    "Answer only from the bounded knowledge context supplied by the application.",
    "Return JSON matching the supplied schema; never return markdown or free text outside that JSON.",
    "Use concise output: answer only the requested facts, use one short sentence per finding, and keep claims minimal.",
    "Every material claim must include one or more citation_label values that exist in the context.",
    "Every claim must use the shortest exact quote that supports it, preserving source wording.",
    "Before answering, match the requested entity, metric, period, unit, and actual-versus-forecast qualifier to the cited source; never transfer a value from a different entity, document, or metric.",
    "When a year-level metric is explicitly available for a year-level question, use it instead of a narrower monthly value. A year-only question does not require the source to say full-year; state the period distinction when a monthly value also appears, but do not mark evidence insufficient solely because that narrower value differs.",
    "If one source explicitly names the requested entity and provides the requested metric, use that source. A different value from a source naming another entity, or no matching entity, does not create an entity conflict.",
    "When context explicitly says requested information was not provided, listed, disclosed, or reported, cite that exact source statement and explain the gap instead of returning a generic refusal.",
    "Recognize common bilingual KPI labels when matching direct evidence; for example, first-pass yield corresponds to 一次检验合格率, while incoming first-pass yield may be a narrower inbound metric.",
    "If retrieved context mentions a similar value but does not directly support the requested entity and metric, set insufficient_evidence=true instead of substituting that value.",
    "For questions about scanned pages, images, or charts, use only verified extracted source text; when that evidence is absent, refuse and direct the user to OCR review or manual verification.",
    "If the context is insufficient, set insufficient_evidence=true, keep claims limited to supported facts, and explain the limitation.",
    "Respond in the same language as the user's query.",
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

    const visualEvidenceAvailable = hasVerifiedVisualEvidence(input.context.chunks);
    if ((input.visualEvidenceRequired || VISUAL_QUERY_PATTERN.test(input.query)) && !visualEvidenceAvailable) {
      return {
        structuredAnswer: {
          answer: VISUAL_SOURCE_REVIEW_ANSWER,
          claims: [],
          limitations: ["检索结果未包含可核验的图表或图像来源；相似文本来源不能替代图像证据。"],
          insufficientEvidence: true,
        },
        model: null,
        promptVersion: this.promptVersion,
        inputTokens: null,
        outputTokens: null,
        providerRequestId: null,
      };
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
        temperature: 0,
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
