import { describe, expect, it } from "vitest";

import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import { LocalVectorIndex } from "./local-vector-index";

function record(input: {
  chunkId: string;
  documentId: string;
  text: string;
  vector: number[];
}): Parameters<LocalVectorIndex["add"]>[0] {
  const chunk: RetrievedChunk = {
    rank: 1,
    chunkId: input.chunkId,
    documentId: input.documentId,
    documentName: `${input.documentId}.txt`,
    documentVersion: 1,
    documentMimeType: "text/plain",
    chunkIndex: 0,
    text: input.text,
    tokenCount: 1,
    similarityScore: 0,
    distance: 1,
    metadata: {},
    documentMetadata: {},
    locator: {
      pageStart: null,
      pageEnd: null,
      lineStart: 1,
      lineEnd: 1,
      startChar: 0,
      endChar: input.text.length,
      sectionPath: null,
      sourceSegments: [],
    },
    embedding: {
      provider: "test-only",
      model: "test-only",
      modelVersion: "test-only",
      dimension: input.vector.length,
      embeddedAt: "2026-10-23T00:00:00.000Z",
    },
  };

  return {
    knowledgeBaseId: "kb-test",
    chunk,
    source: {
      chunkId: input.chunkId,
      documentId: input.documentId,
      documentName: `${input.documentId}.txt`,
      documentVersion: 1,
      documentStatus: "ready",
      chunkText: input.text,
      locator: {},
    },
    vector: input.vector,
  };
}

describe("LocalVectorIndex", () => {
  it("ranks stored vectors by cosine similarity and preserves source membership", async () => {
    const index = new LocalVectorIndex();
    index.add(record({ chunkId: "chunk-a", documentId: "doc-a", text: "nearest", vector: [1, 0] }));
    index.add(record({ chunkId: "chunk-b", documentId: "doc-b", text: "farther", vector: [0, 1] }));

    const matches = await index.matchChunks({
      queryEmbedding: [0.9, 0.1],
      knowledgeBaseId: "kb-test",
      topK: 2,
      similarityThreshold: 0,
    });

    expect(matches.map((chunk) => chunk.chunkId)).toEqual(["chunk-a", "chunk-b"]);
    expect(matches[0]?.similarityScore).toBeGreaterThan(matches[1]?.similarityScore ?? 0);
    expect(await index.loadByChunkIds(["chunk-a", "missing"])).toMatchObject([
      { chunkId: "chunk-a", documentId: "doc-a", chunkText: "nearest" },
    ]);
  });

  it("rejects mismatched and non-finite stored vectors", () => {
    const index = new LocalVectorIndex();
    expect(() => index.add(record({ chunkId: "bad-dimension", documentId: "doc", text: "text", vector: [1, 0] }))).not.toThrow();
    expect(() => index.add({
      ...record({ chunkId: "bad-value", documentId: "doc", text: "text", vector: [1, 0] }),
      chunk: {
        ...record({ chunkId: "bad-value", documentId: "doc", text: "text", vector: [1, 0] }).chunk,
        embedding: {
          ...record({ chunkId: "bad-value", documentId: "doc", text: "text", vector: [1, 0] }).chunk.embedding,
          dimension: 3,
        },
      },
    })).toThrow(/dimension/i);
    expect(() => index.add({
      ...record({ chunkId: "non-finite", documentId: "doc", text: "text", vector: [1, 0] }),
      vector: [1, Number.NaN],
    })).toThrow(/finite/i);
  });
});
