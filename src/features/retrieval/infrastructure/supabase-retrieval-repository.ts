import "server-only";

import { EMBEDDING_DIMENSION, type JsonObject, type JsonValue } from "@/domain";
import {
  RetrievalRepositoryError,
  type MatchChunksInput,
  type RetrievalRepository,
} from "@/features/retrieval/application/retrieval-repository";
import type {
  RetrievedChunk,
  RetrievalLocator,
  RetrievalSourceSegmentLocator,
} from "@/features/retrieval/domain/retrieval";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface RetrievalRpcResult {
  data: unknown;
  error: unknown;
}

/** Narrow injectable boundary so repository mapping can be tested without Supabase. */
export interface RetrievalRpcClient {
  rpc(
    functionName: "match_document_chunks",
    args: Record<string, unknown>,
  ): PromiseLike<RetrievalRpcResult>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function invalidResponse(message: string): never {
  throw new RetrievalRepositoryError(message, "INVALID_RESPONSE");
}

function requiredString(
  row: UnknownRecord,
  key: string,
  label: string = key,
): string {
  const value = row[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    invalidResponse(`Retriever RPC returned an invalid ${label}.`);
  }

  return value;
}

function nullableString(row: UnknownRecord, key: string): string | null {
  const value = row[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    invalidResponse(`Retriever RPC returned an invalid ${key}.`);
  }

  return value;
}

function requiredInteger(
  row: UnknownRecord,
  key: string,
  minimum: number,
): number {
  const value = row[key];

  if (!Number.isInteger(value) || (value as number) < minimum) {
    invalidResponse(`Retriever RPC returned an invalid ${key}.`);
  }

  return value as number;
}

function nullableInteger(
  row: UnknownRecord,
  key: string,
  minimum: number,
): number | null {
  const value = row[key];

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || (value as number) < minimum) {
    invalidResponse(`Retriever RPC returned an invalid ${key}.`);
  }

  return value as number;
}

function boundedNumber(
  row: UnknownRecord,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = row[key];

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidResponse(`Retriever RPC returned an invalid ${key}.`);
  }

  return value;
}

function jsonObject(row: UnknownRecord, key: string): JsonObject {
  const value = row[key];

  if (!isRecord(value) || !isJsonValue(value)) {
    invalidResponse(`Retriever RPC returned invalid JSON for ${key}.`);
  }

  return value as JsonObject;
}

function isoDateTime(row: UnknownRecord, key: string): string {
  const value = requiredString(row, key);

  if (!Number.isFinite(Date.parse(value))) {
    invalidResponse(`Retriever RPC returned an invalid ${key}.`);
  }

  return value;
}

function sourceSegmentLocator(value: unknown): RetrievalSourceSegmentLocator {
  if (!isRecord(value)) {
    invalidResponse("Retriever RPC returned an invalid source segment locator.");
  }

  const locator = value.locator;

  if (!isRecord(locator)) {
    invalidResponse("Retriever RPC returned a source segment without a locator.");
  }

  const sourceBlockId = value.sourceBlockId;

  if (sourceBlockId !== null && typeof sourceBlockId !== "string") {
    invalidResponse("Retriever RPC returned an invalid sourceBlockId.");
  }

  return {
    sourceBlockId,
    pageStart: nullableInteger(locator, "pageStart", 1),
    pageEnd: nullableInteger(locator, "pageEnd", 1),
    lineStart: nullableInteger(locator, "lineStart", 1),
    lineEnd: nullableInteger(locator, "lineEnd", 1),
    startChar: nullableInteger(locator, "startChar", 0),
    endChar: nullableInteger(locator, "endChar", 1),
  };
}

function locatorFrom(row: UnknownRecord): RetrievalLocator {
  const locator = row.locator;

  if (!isRecord(locator)) {
    invalidResponse("Retriever RPC returned an invalid chunk locator.");
  }

  const rawSegments = locator.sourceSegments;

  if (!Array.isArray(rawSegments)) {
    invalidResponse("Retriever RPC returned invalid source segment locators.");
  }

  const sourceSegments = rawSegments.map(sourceSegmentLocator);
  const lineStarts = sourceSegments.flatMap((segment) =>
    segment.lineStart === null ? [] : [segment.lineStart],
  );
  const lineEnds = sourceSegments.flatMap((segment) =>
    segment.lineEnd === null ? [] : [segment.lineEnd],
  );

  return {
    pageStart: nullableInteger(locator, "pageStart", 1),
    pageEnd: nullableInteger(locator, "pageEnd", 1),
    lineStart: lineStarts.length > 0 ? Math.min(...lineStarts) : null,
    lineEnd: lineEnds.length > 0 ? Math.max(...lineEnds) : null,
    startChar: nullableInteger(locator, "startChar", 0),
    endChar: nullableInteger(locator, "endChar", 1),
    sectionPath: nullableString(locator, "sectionPath"),
    sourceSegments,
  };
}

function toRetrievedChunk(value: unknown): RetrievedChunk {
  if (!isRecord(value)) {
    invalidResponse("Retriever RPC returned a non-object result row.");
  }

  const embeddingDimension = requiredInteger(value, "embedding_dimension", 1);

  if (embeddingDimension !== EMBEDDING_DIMENSION) {
    invalidResponse(
      `Retriever RPC returned an embedding dimension other than ${EMBEDDING_DIMENSION}.`,
    );
  }

  return {
    rank: requiredInteger(value, "rank", 1),
    chunkId: requiredString(value, "chunk_id", "chunk ID"),
    documentId: requiredString(value, "document_id", "document ID"),
    documentName: requiredString(value, "document_name"),
    documentVersion: requiredInteger(value, "document_version", 1),
    documentMimeType: requiredString(value, "document_mime_type"),
    chunkIndex: requiredInteger(value, "chunk_index", 0),
    text: requiredString(value, "chunk_text"),
    tokenCount: requiredInteger(value, "token_count", 1),
    similarityScore: boundedNumber(value, "similarity_score", 0, 1),
    distance: boundedNumber(value, "distance", 0, 2),
    metadata: jsonObject(value, "metadata"),
    documentMetadata: jsonObject(value, "document_metadata"),
    locator: locatorFrom(value),
    embedding: {
      provider: requiredString(value, "embedding_provider"),
      model: requiredString(value, "embedding_model"),
      modelVersion: requiredString(value, "embedding_model_version"),
      dimension: embeddingDimension,
      embeddedAt: isoDateTime(value, "embedded_at"),
    },
  };
}

function assertInput(input: MatchChunksInput): void {
  if (!input.knowledgeBaseId.trim()) {
    throw new RetrievalRepositoryError(
      "A knowledge base ID is required for retrieval.",
      "INVALID_INPUT",
    );
  }

  if (
    input.queryEmbedding.length !== EMBEDDING_DIMENSION ||
    input.queryEmbedding.some((value) => !Number.isFinite(value))
  ) {
    throw new RetrievalRepositoryError(
      `The query embedding must contain ${EMBEDDING_DIMENSION} finite values.`,
      "INVALID_INPUT",
    );
  }

  if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > 50) {
    throw new RetrievalRepositoryError(
      "topK must be an integer between 1 and 50.",
      "INVALID_INPUT",
    );
  }

  if (
    !Number.isFinite(input.similarityThreshold) ||
    input.similarityThreshold < 0 ||
    input.similarityThreshold > 1
  ) {
    throw new RetrievalRepositoryError(
      "similarityThreshold must be between 0 and 1.",
      "INVALID_INPUT",
    );
  }

  if (input.documentIds?.some((documentId) => documentId.trim().length === 0)) {
    throw new RetrievalRepositoryError(
      "Document filters cannot contain blank IDs.",
      "INVALID_INPUT",
    );
  }
}

export class SupabaseRetrievalRepository implements RetrievalRepository {
  constructor(
    private readonly client: RetrievalRpcClient =
      getSupabaseAdminClient() as unknown as RetrievalRpcClient,
  ) {}

  async matchChunks(input: MatchChunksInput): Promise<RetrievedChunk[]> {
    assertInput(input);

    const documentIds = input.documentIds && input.documentIds.length > 0
      ? Array.from(new Set(input.documentIds.map((documentId) => documentId.trim())))
      : null;
    const { data, error } = await this.client.rpc("match_document_chunks", {
      query_embedding: Array.from(input.queryEmbedding),
      knowledge_base: input.knowledgeBaseId.trim(),
      match_count: input.topK,
      similarity_threshold: input.similarityThreshold,
      filter_document_ids: documentIds,
    });

    if (error) {
      throw new RetrievalRepositoryError(
        "Relevant knowledge chunks could not be retrieved.",
        "QUERY_FAILED",
        { cause: error },
      );
    }

    if (!Array.isArray(data)) {
      invalidResponse("Retriever RPC returned a non-array response.");
    }

    const results = data.map(toRetrievedChunk);

    if (results.length > input.topK) {
      invalidResponse("Retriever RPC returned more rows than the requested topK.");
    }

    for (let index = 0; index < results.length; index += 1) {
      if (results[index]?.rank !== index + 1) {
        invalidResponse("Retriever RPC returned non-contiguous result ranks.");
      }
    }

    return results;
  }
}
