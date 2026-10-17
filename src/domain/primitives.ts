/** Shared, transport-safe primitives used by the Novera AI domain. */
export type UUID = string;
export type ISODateTime = string;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Scores shown by the Evidence Layer are normalized to the inclusive 0–100 range. */
export type QualityScore = number;

/** Phase 1 pgvector column size. It must match the configured embedding provider. */
export const EMBEDDING_DIMENSION = 1536 as const;

/** Seeded by the Phase 1 migration for the single-knowledge-base MVP. */
export const DEFAULT_KNOWLEDGE_BASE_ID =
  "00000000-0000-4000-8000-000000000001" as const;

export const DEFAULT_KNOWLEDGE_BASE_SLUG = "default" as const;
