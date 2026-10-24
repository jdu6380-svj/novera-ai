import type { JsonObject, UUID } from "@/domain";
import type {
  EvidenceSourceRepository,
} from "@/features/qa/application/evidence-source-repository";
import type { SourceVerificationRecord } from "@/features/qa/domain/qa";
import {
  RetrievalRepositoryError,
  type MatchChunksInput,
  type RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";

export interface LocalVectorRecord {
  knowledgeBaseId: UUID;
  chunk: RetrievedChunk;
  source: SourceVerificationRecord;
  vector: readonly number[];
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new RetrievalRepositoryError("Vector dimensions do not match.", "INVALID_INPUT");
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new RetrievalRepositoryError("Vectors must contain finite values.", "INVALID_INPUT");
    }
    dot += leftValue! * rightValue!;
    leftMagnitude += leftValue! * leftValue!;
    rightMagnitude += rightValue! * rightValue!;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    throw new RetrievalRepositoryError("Zero vectors cannot be ranked.", "INVALID_INPUT");
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function sourceLocator(record: LocalVectorRecord): JsonObject {
  return {
    pageStart: record.chunk.locator.pageStart,
    pageEnd: record.chunk.locator.pageEnd,
    lineStart: record.chunk.locator.lineStart,
    lineEnd: record.chunk.locator.lineEnd,
    startChar: record.chunk.locator.startChar,
    endChar: record.chunk.locator.endChar,
    sectionPath: record.chunk.locator.sectionPath,
    sourceSegments: record.chunk.locator.sourceSegments.map((segment) => ({ ...segment })),
  };
}

/** Process-local vector storage for isolated evaluation; it never contacts Supabase. */
export class LocalVectorIndex implements RetrievalRepository, EvidenceSourceRepository {
  private readonly records = new Map<UUID, LocalVectorRecord>();

  add(record: LocalVectorRecord): void {
    if (record.vector.length !== record.chunk.embedding.dimension) {
      throw new RetrievalRepositoryError("Stored vector dimension does not match its metadata.", "INVALID_INPUT");
    }
    if (record.vector.some((value) => !Number.isFinite(value))) {
      throw new RetrievalRepositoryError("Stored vectors must contain finite values.", "INVALID_INPUT");
    }
    if (this.records.has(record.chunk.chunkId)) {
      throw new RetrievalRepositoryError("Chunk identifiers must be unique.", "INVALID_INPUT");
    }
    this.records.set(record.chunk.chunkId, record);
  }

  get size(): number {
    return this.records.size;
  }

  async matchChunks(input: MatchChunksInput): Promise<RetrievedChunk[]> {
    const candidates = [...this.records.values()]
      .filter((record) => record.knowledgeBaseId === input.knowledgeBaseId)
      .filter((record) => record.source.documentStatus === "ready")
      .filter((record) => !input.documentIds || input.documentIds.includes(record.chunk.documentId))
      .map((record) => ({
        record,
        similarity: cosineSimilarity(record.vector, input.queryEmbedding),
      }))
      .filter(({ similarity }) => similarity >= input.similarityThreshold && similarity >= 0)
      .sort((left, right) =>
        right.similarity - left.similarity ||
        left.record.chunk.documentId.localeCompare(right.record.chunk.documentId) ||
        left.record.chunk.chunkIndex - right.record.chunk.chunkIndex,
      )
      .slice(0, input.topK);

    return candidates.map(({ record, similarity }, index) => ({
      ...record.chunk,
      rank: index + 1,
      similarityScore: similarity,
      distance: 1 - similarity,
    }));
  }

  async loadByChunkIds(chunkIds: readonly string[]): Promise<SourceVerificationRecord[]> {
    return [...new Set(chunkIds)].flatMap((chunkId) => {
      const record = this.records.get(chunkId);
      if (!record) return [];
      return [{ ...record.source, locator: sourceLocator(record) }];
    });
  }
}
