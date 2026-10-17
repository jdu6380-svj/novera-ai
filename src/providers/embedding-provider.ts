import type { EmbeddingVector, ISODateTime } from "@/domain";

export interface EmbeddingBatch {
  /** Stable provider identifier persisted with every generated vector. */
  provider: string;
  /** Exact model identifier sent to the provider. */
  model: string;
  /** Novera-managed model revision/deployment label used for auditability. */
  modelVersion: string;
  dimensions: number;
  /** Completion time for this successful embedding batch. */
  embeddedAt: ISODateTime;
  vectors: EmbeddingVector[];
  usageTokens: number | null;
}

/** Provider boundary for document and query embeddings. */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;

  embed(inputs: readonly string[]): Promise<EmbeddingBatch>;
}
