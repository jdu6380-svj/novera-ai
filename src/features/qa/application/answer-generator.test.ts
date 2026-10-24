import { describe, expect, it } from "vitest";

import type { JsonObject } from "@/domain";
import type { LanguageModelProvider, StructuredGenerationRequest } from "@/providers";
import type { QueryUnderstandingResult } from "@/features/retrieval/application/query-understanding";
import type { BuiltPromptContext } from "@/features/retrieval/application/context-builder";
import { AnswerGenerator } from "./answer-generator";

const understanding: QueryUnderstandingResult = {
  requestedTaskType: "qa",
  understoodTaskType: "qa",
  confidence: 0.9,
  normalizedQuery: "What changed?",
  signals: [],
  details: {},
};

const context = (chunks: BuiltPromptContext["chunks"]): BuiltPromptContext => ({
  context: chunks.map((chunk) => chunk.renderedText).join("\n\n"),
  chunks,
  stats: {
    received: chunks.length,
    selected: chunks.length,
    estimatedTokens: 30,
    characters: 120,
    truncated: 0,
    dropped: {
      invalid: 0,
      belowThreshold: 0,
      duplicate: 0,
      perDocumentLimit: 0,
      maxChunks: 0,
      budget: 0,
    },
  },
  config: {
    minimumSimilarity: 0.35,
    maxChunks: 8,
    maxChunksPerDocument: 3,
    maxTokens: 2400,
    maxCharacters: 12000,
  },
});

describe("AnswerGenerator", () => {
  it("returns structured insufficient evidence without calling the model when context is empty", async () => {
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async () => {
        throw new Error("should not call");
      },
    };
    const result = await new AnswerGenerator(provider).generate({
      query: "What changed?",
      taskUnderstanding: understanding,
      context: context([]),
    });

    expect(result.structuredAnswer.insufficientEvidence).toBe(true);
    expect(result.structuredAnswer.claims).toEqual([]);
    expect(result.model).toBeNull();
  });

  it("refuses chart values when retrieval returned no visual-capable source instead of borrowing a similar metric", async () => {
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async () => {
        throw new Error("should not call");
      },
    };
    const result = await new AnswerGenerator(provider).generate({
      query: "图表显示 2025 年 8 月的一次检验合格率是多少？",
      taskUnderstanding: understanding,
      context: context([
        {
          rank: 1,
          citationLabel: "[S1]",
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "supplier-quality.docx",
          chunkIndex: 0,
          text: "2025 年 8 月来料一次检验合格率为 99.1%。",
          contextText: "2025 年 8 月来料一次检验合格率为 99.1%。",
          renderedText: "[S1] supplier-quality.docx",
          similarityScore: 0.8,
          metadata: {},
          locator: {},
          estimatedContextTokens: 5,
          truncated: false,
        },
      ]),
    });

    expect(result.structuredAnswer.insufficientEvidence).toBe(true);
    expect(result.structuredAnswer.answer).toContain("人工复核");
    expect(result.model).toBeNull();
  });

  it("does not treat an ordinary PDF as verified chart evidence", async () => {
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async () => {
        throw new Error("should not call");
      },
    };
    const result = await new AnswerGenerator(provider).generate({
      query: "图表显示 2025 年 8 月的一次检验合格率是多少？",
      taskUnderstanding: understanding,
      context: context([{
        rank: 1,
        citationLabel: "[S1]",
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "annual-report.pdf",
        chunkIndex: 0,
        text: "2025 年 8 月一次检验合格率为 99.1%。",
        contextText: "2025 年 8 月一次检验合格率为 99.1%。",
        renderedText: "[S1] annual-report.pdf",
        similarityScore: 0.8,
        metadata: { evidence: { sourceSegments: [{ metadata: {} }] } },
        locator: {},
        estimatedContextTokens: 5,
        truncated: false,
      }]),
    });

    expect(result.structuredAnswer.insufficientEvidence).toBe(true);
    expect(result.structuredAnswer.answer).toContain("人工复核");
    expect(result.model).toBeNull();
  });

  it("allows high-confidence OCR evidence for a visual query", async () => {
    let providerCalls = 0;
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async <TOutput extends JsonObject>() => {
        providerCalls += 1;
        return {
          output: {
            answer: "一次检验合格率为 99.1%。",
            claims: [{ claim_text: "一次检验合格率为 99.1%。", claim_type: "fact", weight: 8, evidence: [] }],
            limitations: [],
            insufficient_evidence: false,
          } as unknown as TOutput,
          model: "fake",
          inputTokens: 1,
          outputTokens: 1,
          providerRequestId: null,
        };
      },
    };
    const result = await new AnswerGenerator(provider).generate({
      query: "图表显示 2025 年 8 月的一次检验合格率是多少？",
      taskUnderstanding: understanding,
      context: context([{
        rank: 1,
        citationLabel: "[S1]",
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "quality-chart.png",
        chunkIndex: 0,
        text: "2025 年 8 月一次检验合格率为 99.1%。",
        contextText: "2025 年 8 月一次检验合格率为 99.1%。",
        renderedText: "[S1] quality-chart.png",
        similarityScore: 0.8,
        metadata: {
          evidence: {
            sourceSegments: [{ metadata: { extractionMethod: "tesseract-ocr", confidence: 96 } }],
          },
        },
        locator: {},
        estimatedContextTokens: 5,
        truncated: false,
      }]),
    });

    expect(result.model).toBe("fake");
    expect(providerCalls).toBe(1);
  });

  it("converts provider JSON into the structured answer contract", async () => {
    let capturedSystemPrompt = "";
    let capturedTemperature: number | undefined;
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async <TOutput extends JsonObject>(request: StructuredGenerationRequest) => {
        capturedSystemPrompt = request.systemPrompt;
        capturedTemperature = request.temperature;
        return {
          output: {
            answer: "The onboarding flow changed.",
            claims: [
              {
                claim_text: "The onboarding flow changed.",
                claim_type: "fact",
                weight: 1,
                evidence: [{ citation_label: "[S1]", quote: "Onboarding v2" }],
              },
            ],
            limitations: [],
            insufficient_evidence: false,
          } as unknown as TOutput,
          model: "fake",
          inputTokens: 12,
          outputTokens: 18,
          providerRequestId: "req-1",
        };
      },
    };
    const result = await new AnswerGenerator(provider).generate({
      query: "What changed?",
      taskUnderstanding: understanding,
      context: context([
        {
          rank: 1,
          citationLabel: "[S1]",
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "PRD",
          chunkIndex: 0,
          text: "Onboarding v2",
          contextText: "Onboarding v2",
          renderedText: "[S1]\nOnboarding v2",
          similarityScore: 0.8,
          metadata: {},
          locator: {},
          estimatedContextTokens: 5,
          truncated: false,
        },
      ]),
    });

    expect(result.structuredAnswer.answer).toBe("The onboarding flow changed.");
    expect(result.inputTokens).toBe(12);
    expect(result.structuredAnswer.claims[0]?.evidence[0]?.quote).toBe("Onboarding v2");
    expect(capturedSystemPrompt).toContain("Use concise output");
    expect(capturedSystemPrompt).toContain("shortest exact quote");
    expect(capturedSystemPrompt).toContain("never transfer a value from a different entity");
    expect(capturedSystemPrompt).toContain("does not directly support the requested entity and metric");
    expect(capturedSystemPrompt).toContain("A year-only question does not require the source to say full-year");
    expect(capturedSystemPrompt).toContain("A different value from a source naming another entity");
    expect(capturedSystemPrompt).toContain("cite that exact source statement");
    expect(capturedSystemPrompt).toContain("first-pass yield corresponds to 一次检验合格率");
    expect(capturedSystemPrompt).toContain("direct the user to OCR review or manual verification");
    expect(capturedSystemPrompt).toContain("same language as the user's query");
    expect(capturedTemperature).toBe(0);
  });
});
