import type { ISODateTime } from "@/domain";
import {
  RetrievalRepositoryError,
  type RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import type { RetrieverConfig } from "@/features/retrieval/application/retriever-config";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import { reviewRequiredExtractionWarnings } from "@/features/knowledge-processing/content/extraction-warnings";
import type { EmbeddingProvider } from "@/providers";
import { expandBilingualRetrievalQuery } from "@/features/retrieval/application/retrieval-query-expansion";

export interface RetrieveKnowledgeInput {
  query: string;
  knowledgeBaseId: string;
  topK?: number;
  similarityThreshold?: number;
  documentIds?: readonly string[];
}

export interface QueryEmbeddingAudit {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  embeddedAt: ISODateTime;
  usageTokens: number | null;
  embeddingVariants?: number;
  queryExpansionTerms?: string[];
}

export interface RetrieveKnowledgeResult {
  query: string;
  topK: number;
  similarityThreshold: number;
  chunks: RetrievedChunk[];
  embedding: QueryEmbeddingAudit;
}

function normalizeQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeDocumentIds(documentIds: readonly string[] | undefined): string[] | undefined {
  if (!documentIds) {
    return undefined;
  }

  return [...new Set(documentIds.map((documentId) => documentId.trim()))];
}

export class RetrieverService {
  constructor(
    private readonly repository: RetrievalRepository,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly config: RetrieverConfig,
  ) {}

  async retrieve(input: RetrieveKnowledgeInput): Promise<RetrieveKnowledgeResult> {
    const query = normalizeQuery(input.query);
    const expansion = expandBilingualRetrievalQuery(query);
    const topK = input.topK ?? this.config.defaultTopK;
    const similarityThreshold =
      input.similarityThreshold ?? this.config.defaultSimilarityThreshold;
    const documentIds = normalizeDocumentIds(input.documentIds);

    this.validate({
      query,
      knowledgeBaseId: input.knowledgeBaseId,
      topK,
      similarityThreshold,
      documentIds,
    });

    let batch;

    try {
      batch = await this.embeddingProvider.embed(expansion.embeddingQueries);
    } catch (error) {
      throw new RetrievalError(
        "The user query could not be embedded.",
        "QUERY_EMBEDDING_FAILED",
        502,
        undefined,
        { cause: error },
      );
    }

    if (
      batch.vectors.length !== expansion.embeddingQueries.length ||
      batch.vectors.some((vector) =>
        !vector || vector.length !== this.embeddingProvider.dimensions,
      ) ||
      batch.dimensions !== this.embeddingProvider.dimensions
    ) {
      throw new RetrievalError(
        "The query embedding response did not match the configured vector contract.",
        "QUERY_EMBEDDING_FAILED",
        502,
        {
          expected_dimensions: this.embeddingProvider.dimensions,
          received_dimensions: batch.vectors[0]?.length ?? null,
          received_vector_count: batch.vectors.length,
        },
      );
    }

    let chunks: RetrievedChunk[];

    try {
      const results = await Promise.all(batch.vectors.map((queryEmbedding) =>
        this.repository.matchChunks({
          queryEmbedding,
          knowledgeBaseId: input.knowledgeBaseId,
          topK,
          similarityThreshold,
          documentIds,
        }),
      ));
      const bestByChunkId = new Map<string, RetrievedChunk>();
      for (const result of results) {
        for (const chunk of result) {
          const previous = bestByChunkId.get(chunk.chunkId);
          if (!previous || chunk.similarityScore > previous.similarityScore) {
            bestByChunkId.set(chunk.chunkId, chunk);
          }
        }
      }
      chunks = [...bestByChunkId.values()]
        .sort((left, right) =>
          right.similarityScore - left.similarityScore ||
          left.documentId.localeCompare(right.documentId) ||
          left.chunkIndex - right.chunkIndex,
        )
        .slice(0, topK)
        .map((chunk, index) => ({ ...chunk, rank: index + 1 }));
    } catch (error) {
      const details =
        error instanceof RetrievalRepositoryError
          ? { repository_code: error.code }
          : undefined;

      throw new RetrievalError(
        "Relevant knowledge chunks could not be retrieved.",
        "VECTOR_RETRIEVAL_FAILED",
        500,
        details,
        { cause: error },
      );
    }

    const eligibleChunks = chunks
      .filter((chunk) => {
        const qaEligibility = chunk.metadata.qaEligibility;
        if (qaEligibility && typeof qaEligibility === "object" && !Array.isArray(qaEligibility)) {
          const status = qaEligibility.status;
          if (status === "eligible") return true;
          if (status === "review_required") return false;
        }
        return reviewRequiredExtractionWarnings(chunk.documentMetadata).length === 0;
      })
      .slice(0, topK)
      .map((chunk, index) => ({ ...chunk, rank: index + 1 }));

    return {
      query,
      topK,
      similarityThreshold,
      chunks: eligibleChunks,
      embedding: {
        provider: batch.provider,
        model: batch.model,
        modelVersion: batch.modelVersion,
        dimensions: batch.dimensions,
        embeddedAt: batch.embeddedAt,
        usageTokens: batch.usageTokens,
        embeddingVariants: batch.vectors.length,
        queryExpansionTerms: expansion.terms,
      },
    };
  }

  private validate(input: {
    query: string;
    knowledgeBaseId: string;
    topK: number;
    similarityThreshold: number;
    documentIds?: readonly string[];
  }): void {
    if (!input.query) {
      throw new RetrievalError(
        "A non-empty query is required.",
        "INVALID_REQUEST",
        400,
      );
    }

    if (input.query.length > this.config.maximumQueryCharacters) {
      throw new RetrievalError(
        `The query must not exceed ${this.config.maximumQueryCharacters} characters.`,
        "INVALID_REQUEST",
        400,
      );
    }

    if (!input.knowledgeBaseId.trim()) {
      throw new RetrievalError(
        "A knowledge base ID is required.",
        "INVALID_REQUEST",
        400,
      );
    }

    if (
      !Number.isSafeInteger(input.topK) ||
      input.topK < 1 ||
      input.topK > this.config.maximumTopK
    ) {
      throw new RetrievalError(
        `topK must be an integer between 1 and ${this.config.maximumTopK}.`,
        "INVALID_REQUEST",
        400,
      );
    }

    if (
      !Number.isFinite(input.similarityThreshold) ||
      input.similarityThreshold < 0 ||
      input.similarityThreshold > 1
    ) {
      throw new RetrievalError(
        "similarityThreshold must be between 0 and 1.",
        "INVALID_REQUEST",
        400,
      );
    }

    if (input.documentIds?.some((documentId) => !documentId)) {
      throw new RetrievalError(
        "documentIds must not contain blank values.",
        "INVALID_REQUEST",
        400,
      );
    }
  }
}
