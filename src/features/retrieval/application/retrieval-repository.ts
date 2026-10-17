import type { EmbeddingVector } from "@/domain";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";

export interface MatchChunksInput {
  queryEmbedding: EmbeddingVector;
  knowledgeBaseId: string;
  topK: number;
  similarityThreshold: number;
  documentIds?: readonly string[] | null;
}

/** Persistence boundary for cosine-similarity retrieval. */
export interface RetrievalRepository {
  matchChunks(input: MatchChunksInput): Promise<RetrievedChunk[]>;
}

export type RetrievalRepositoryErrorCode =
  | "INVALID_INPUT"
  | "QUERY_FAILED"
  | "INVALID_RESPONSE";

export class RetrievalRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: RetrievalRepositoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RetrievalRepositoryError";
  }
}
