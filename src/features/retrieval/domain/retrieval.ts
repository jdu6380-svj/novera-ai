import type {
  ISODateTime,
  JsonObject,
  UUID,
} from "@/domain/primitives";

/** Fine-grained source position retained for Evidence Layer quotations. */
export interface RetrievalSourceSegmentLocator {
  sourceBlockId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  startChar: number | null;
  endChar: number | null;
}

/** Stable source locator from a retrieved chunk back to its document text. */
export interface RetrievalLocator {
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  startChar: number | null;
  endChar: number | null;
  sectionPath: string | null;
  sourceSegments: readonly RetrievalSourceSegmentLocator[];
}

/** Embedding provenance needed to audit retrieval across model revisions. */
export interface RetrievedChunkEmbedding {
  provider: string;
  model: string;
  modelVersion: string;
  dimension: number;
  embeddedAt: ISODateTime;
}

/**
 * Evidence-ready knowledge recalled by the Retriever.
 *
 * `similarityScore` uses the inclusive 0..1 range accepted by the MVP
 * retrieval policy. The direct document identity and immutable locator keep
 * the later Answer -> Claim -> Evidence -> Source Document chain intact.
 */
export interface RetrievedChunk {
  rank: number;
  chunkId: UUID;
  documentId: UUID;
  documentName: string;
  documentVersion: number;
  documentMimeType: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  similarityScore: number;
  distance: number;
  metadata: JsonObject;
  documentMetadata: JsonObject;
  locator: RetrievalLocator;
  embedding: RetrievedChunkEmbedding;
}
