import type { ISODateTime } from "@/domain";
import {
  RetrievalRepositoryError,
  type RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import type { RetrieverConfig } from "@/features/retrieval/application/retriever-config";
import type { RetrievedChunk } from "@/features/retrieval/domain/retrieval";
import type { EmbeddingProvider } from "@/providers";

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
      batch = await this.embeddingProvider.embed([query]);
    } catch (error) {
      throw new RetrievalError(
        "The user query could not be embedded.",
        "QUERY_EMBEDDING_FAILED",
        502,
        undefined,
        { cause: error },
      );
    }

    const queryEmbedding = batch.vectors[0];

    if (
      batch.vectors.length !== 1 ||
      !queryEmbedding ||
      batch.dimensions !== this.embeddingProvider.dimensions ||
      queryEmbedding.length !== this.embeddingProvider.dimensions
    ) {
      throw new RetrievalError(
        "The query embedding response did not match the configured vector contract.",
        "QUERY_EMBEDDING_FAILED",
        502,
        {
          expected_dimensions: this.embeddingProvider.dimensions,
          received_dimensions: queryEmbedding?.length ?? null,
          received_vector_count: batch.vectors.length,
        },
      );
    }

    let chunks: RetrievedChunk[];

    try {
      chunks = await this.repository.matchChunks({
        queryEmbedding,
        knowledgeBaseId: input.knowledgeBaseId,
        topK,
        similarityThreshold,
        documentIds,
      });
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

    return {
      query,
      topK,
      similarityThreshold,
      chunks,
      embedding: {
        provider: batch.provider,
        model: batch.model,
        modelVersion: batch.modelVersion,
        dimensions: batch.dimensions,
        embeddedAt: batch.embeddedAt,
        usageTokens: batch.usageTokens,
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
