import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { JsonObject, JsonValue } from "@/domain";
import {
  EvidenceSourceRepositoryError,
  type EvidenceSourceRepository,
} from "@/features/qa/application/evidence-source-repository";
import type { SourceVerificationRecord } from "@/features/qa/domain/qa";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";

interface EvidenceDocumentRow {
  id: string;
  display_name: string;
  version_no: number;
  status: string;
  deleted_at: string | null;
}

interface EvidenceChunkRow {
  id: string;
  document_id: string;
  text: string;
  page_start: number | null;
  page_end: number | null;
  start_char: number | null;
  end_char: number | null;
  section_path: string | null;
  metadata: JsonObject;
  documents: EvidenceDocumentRow | EvidenceDocumentRow[];
}

function documentFrom(row: EvidenceChunkRow): EvidenceDocumentRow | undefined {
  return Array.isArray(row.documents) ? row.documents[0] : row.documents;
}

function sourceSegments(metadata: JsonObject): JsonValue[] {
  const evidence = metadata.evidence;

  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    return [];
  }

  return Array.isArray(evidence.sourceSegments) ? evidence.sourceSegments : [];
}

function toRecord(row: EvidenceChunkRow): SourceVerificationRecord {
  const document = documentFrom(row);

  if (!document || document.id !== row.document_id) {
    throw new EvidenceSourceRepositoryError(
      "An evidence source was returned without its source document.",
      "INVALID_RESPONSE",
    );
  }

  return {
    chunkId: row.id,
    documentId: row.document_id,
    documentName: document.display_name,
    documentVersion: document.version_no,
    documentStatus:
      document.status === "ready" && document.deleted_at === null
        ? "ready"
        : "not_ready",
    chunkText: row.text,
    locator: {
      page_start: row.page_start,
      page_end: row.page_end,
      start_char: row.start_char,
      end_char: row.end_char,
      section_path: row.section_path,
      source_segments: sourceSegments(row.metadata),
    },
  };
}

export class SupabaseEvidenceSourceRepository implements EvidenceSourceRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseAdminClient()) {}

  async loadByChunkIds(chunkIds: readonly string[]): Promise<SourceVerificationRecord[]> {
    const ids = [...new Set(chunkIds.filter(Boolean))];

    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("document_chunks")
      .select(
        "id,document_id,text,page_start,page_end,start_char,end_char,section_path,metadata,documents!inner(id,display_name,version_no,status,deleted_at)",
      )
      .in("id", ids);

    if (error) {
      throw new EvidenceSourceRepositoryError(
        "Evidence source chunks could not be loaded.",
        "READ_FAILED",
        { cause: error },
      );
    }

    try {
      return (data ?? []).map((row) => toRecord(row as unknown as EvidenceChunkRow));
    } catch (error) {
      if (error instanceof EvidenceSourceRepositoryError) {
        throw error;
      }

      throw new EvidenceSourceRepositoryError(
        "Evidence source rows did not match the expected shape.",
        "INVALID_RESPONSE",
        { cause: error },
      );
    }
  }
}
