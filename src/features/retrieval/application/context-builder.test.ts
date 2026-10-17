import { describe, expect, it } from "vitest";

import { estimateTokenCount } from "@/features/knowledge-processing/content/chunker";

import {
  ContextBuilder,
  ContextBuilderError,
  type ContextSourceChunk,
  formatSourceLocator,
} from "./context-builder";

function chunk(
  overrides: Partial<ContextSourceChunk> & Pick<ContextSourceChunk, "chunkId">,
): ContextSourceChunk {
  const { chunkId, ...rest } = overrides;

  return {
    chunkId,
    documentId: "doc-a",
    documentName: "Activation Research",
    chunkIndex: 0,
    text: "Users could not identify the next action after registration.",
    similarityScore: 0.8,
    metadata: { source_type: "research" },
    locator: {
      pageStart: 2,
      pageEnd: 2,
      lineStart: 10,
      lineEnd: 12,
      startChar: 100,
      endChar: 158,
      sectionPath: ["Onboarding", "Activation"],
    },
    ...rest,
  };
}

describe("ContextBuilder", () => {
  it("filters invalid and low-similarity chunks, then sorts by similarity", () => {
    const result = new ContextBuilder({ minimumSimilarity: 0.5 }).build([
      chunk({ chunkId: "middle", similarityScore: 0.75, text: "Middle result" }),
      chunk({ chunkId: "low", similarityScore: 0.49 }),
      chunk({
        chunkId: "high",
        similarityScore: 0.91,
        documentId: "doc-b",
        text: "High result",
      }),
      chunk({ chunkId: "invalid", text: "  ", similarityScore: 0.99 }),
      chunk({ chunkId: "nan", similarityScore: Number.NaN }),
    ]);

    expect(result.chunks.map((item) => item.chunkId)).toEqual(["high", "middle"]);
    expect(result.stats.dropped).toMatchObject({
      invalid: 2,
      belowThreshold: 1,
    });
  });

  it("deduplicates by chunk identity and normalized text while retaining the highest score", () => {
    const result = new ContextBuilder().build([
      chunk({ chunkId: "shared", similarityScore: 0.7 }),
      chunk({
        chunkId: "shared",
        similarityScore: 0.9,
        documentId: "doc-b",
        text: "Higher-ranked unique text.",
      }),
      chunk({
        chunkId: "copy",
        documentId: "doc-c",
        similarityScore: 0.85,
        text: "  USERS could not identify the next action after registration.  ",
      }),
    ]);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks.map((item) => [item.chunkId, item.similarityScore])).toEqual([
      ["shared", 0.9],
      ["copy", 0.85],
    ]);
    expect(result.stats.dropped.duplicate).toBe(1);
  });

  it("caps evidence per source document before applying the total chunk limit", () => {
    const result = new ContextBuilder({
      maxChunksPerDocument: 2,
      maxChunks: 3,
    }).build([
      chunk({ chunkId: "a-1", chunkIndex: 1, similarityScore: 0.99, text: "A1" }),
      chunk({ chunkId: "a-2", chunkIndex: 2, similarityScore: 0.98, text: "A2" }),
      chunk({ chunkId: "a-3", chunkIndex: 3, similarityScore: 0.97, text: "A3" }),
      chunk({
        chunkId: "b-1",
        documentId: "doc-b",
        chunkIndex: 1,
        similarityScore: 0.96,
        text: "B1",
      }),
      chunk({
        chunkId: "c-1",
        documentId: "doc-c",
        chunkIndex: 1,
        similarityScore: 0.95,
        text: "C1",
      }),
    ]);

    expect(result.chunks.map((item) => item.chunkId)).toEqual(["a-1", "a-2", "b-1"]);
    expect(result.stats.dropped.perDocumentLimit).toBe(1);
    expect(result.stats.dropped.maxChunks).toBe(1);
  });

  it("emits stable citation labels and preserves evidence/source traceability", () => {
    const source = chunk({ chunkId: "evidence-1" });
    const result = new ContextBuilder().build([source]);
    const selected = result.chunks[0];

    expect(selected).toMatchObject({
      citationLabel: "[S1]",
      rank: 1,
      chunkId: "evidence-1",
      documentId: "doc-a",
      documentName: "Activation Research",
      metadata: { source_type: "research" },
      locator: source.locator,
    });
    expect(result.context).toContain("[S1]");
    expect(result.context).toContain("Source: Activation Research");
    expect(result.context).toContain("document_id=doc-a; chunk_id=evidence-1");
    expect(result.context).toContain(
      "section Onboarding > Activation | page 2 | line 10-12 | chars 100-158",
    );
  });

  it("obeys both token and character budgets by truncating selected evidence", () => {
    const result = new ContextBuilder({
      maxTokens: 55,
      maxCharacters: 320,
      maxChunks: 2,
    }).build([
      chunk({
        chunkId: "long",
        text: Array.from({ length: 80 }, (_, index) => `evidence-${index}`).join(" "),
        similarityScore: 0.95,
      }),
      chunk({
        chunkId: "next",
        documentId: "doc-b",
        text: "Secondary evidence that may not fit.",
        similarityScore: 0.9,
      }),
    ]);

    expect(result.context.length).toBeLessThanOrEqual(320);
    expect(estimateTokenCount(result.context)).toBeLessThanOrEqual(55);
    expect(result.stats.characters).toBe(result.context.length);
    expect(result.stats.estimatedTokens).toBe(estimateTokenCount(result.context));
    expect(result.chunks[0]?.truncated).toBe(true);
    expect(result.chunks[0]?.contextText).toContain("[truncated]");
  });

  it("skips a chunk when even its source header cannot fit the remaining budget", () => {
    const result = new ContextBuilder({
      maxTokens: 5,
      maxCharacters: 30,
    }).build([chunk({ chunkId: "too-large" })]);

    expect(result.context).toBe("");
    expect(result.chunks).toEqual([]);
    expect(result.stats.dropped.budget).toBe(1);
  });

  it("uses deterministic source identity and chunk order as score tie-breakers", () => {
    const input = [
      chunk({ chunkId: "z", documentId: "doc-b", chunkIndex: 0, text: "Z" }),
      chunk({ chunkId: "b", documentId: "doc-a", chunkIndex: 2, text: "B" }),
      chunk({ chunkId: "a", documentId: "doc-a", chunkIndex: 1, text: "A" }),
    ];

    const first = new ContextBuilder().build(input);
    const second = new ContextBuilder().build([...input].reverse());

    expect(first.chunks.map((item) => item.chunkId)).toEqual(["a", "b", "z"]);
    expect(second.context).toBe(first.context);
  });

  it("does not mutate candidates or share mutable source metadata in its output", () => {
    const source = chunk({ chunkId: "immutable" });
    const original = structuredClone(source);
    const result = new ContextBuilder().build([source]);

    expect(source).toEqual(original);
    result.chunks[0]!.metadata.changed = true;
    const sectionPath = result.chunks[0]!.locator.sectionPath;

    if (Array.isArray(sectionPath)) {
      sectionPath.push("Changed");
    }

    expect(source.metadata).toEqual({ source_type: "research" });
    expect(source.locator.sectionPath).toEqual(["Onboarding", "Activation"]);
  });

  it.each([
    [{ minimumSimilarity: Number.NaN }, "minimumSimilarity"],
    [{ minimumSimilarity: 1.1 }, "minimumSimilarity"],
    [{ maxChunks: 0 }, "maxChunks"],
    [{ maxChunksPerDocument: 1.5 }, "maxChunksPerDocument"],
    [{ maxTokens: -1 }, "maxTokens"],
    [{ maxCharacters: 0 }, "maxCharacters"],
  ] as const)("rejects invalid config %j", (options, expectedMessage) => {
    expect(() => new ContextBuilder(options)).toThrowError(
      expect.objectContaining<ContextBuilderError>({
        name: "ContextBuilderError",
        code: "INVALID_CONTEXT_CONFIG",
        message: expect.stringContaining(expectedMessage),
      }),
    );
  });

  it("formats missing, single-value, and section string locators", () => {
    expect(formatSourceLocator({})).toBe("location unavailable");
    expect(
      formatSourceLocator({
        sectionPath: "Support > Refunds",
        pageStart: 4,
        pageEnd: 4,
      }),
    ).toBe("section Support > Refunds | page 4");
  });
});
