import { describe, expect, it } from "vitest";

import type { JsonObject } from "@/domain";
import type { LanguageModelProvider } from "@/providers";
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

  it("converts provider JSON into the structured answer contract", async () => {
    const provider: LanguageModelProvider = {
      model: "fake",
      generateStructured: async <TOutput extends JsonObject>() => ({
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
      }),
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
  });
});
