import type { JsonObject } from "@/domain";
import type { EvidenceSourceRepository } from "./evidence-source-repository";
import type {
  EvidenceVerificationResult,
  GeneratedStructuredAnswer,
  SourceVerificationRecord,
  VerifiedClaim,
} from "@/features/qa/domain/qa";
import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";

export class EvidenceVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceVerificationError";
  }
}

function locatorToJson(locator: {
  pageStart?: number | null;
  pageEnd?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  startChar?: number | null;
  endChar?: number | null;
  sectionPath?: string | string[] | null;
}): JsonObject {
  return {
    page_start: locator.pageStart ?? null,
    page_end: locator.pageEnd ?? null,
    line_start: locator.lineStart ?? null,
    line_end: locator.lineEnd ?? null,
    start_char: locator.startChar ?? null,
    end_char: locator.endChar ?? null,
    section_path: locator.sectionPath ?? null,
  };
}

function evidenceReason(input: {
  citationExists: boolean;
  retrievedThisRun: boolean;
  source: SourceVerificationRecord | undefined;
  documentMatches: boolean;
  quoteInContext: boolean;
  quoteInPersistedSource: boolean;
}): string | null {
  if (!input.citationExists) return "citation_not_in_context";
  if (!input.retrievedThisRun) return "chunk_not_in_retriever_result";
  if (!input.source) return "source_chunk_missing";
  if (input.source.documentStatus !== "ready") return "source_document_not_ready";
  if (!input.documentMatches) return "source_document_mismatch";
  if (!input.quoteInContext) return "quote_not_in_prompt_context";
  if (!input.quoteInPersistedSource) return "quote_not_in_database_source";
  return null;
}

/** Independently revalidates the model's citations against current persisted source text. */
export class EvidenceVerificationLayer {
  constructor(private readonly repository: EvidenceSourceRepository) {}

  async verify(
    answer: GeneratedStructuredAnswer,
    retrieval: RetrievalEngineResult,
  ): Promise<EvidenceVerificationResult> {
    const contextByLabel = new Map(
      retrieval.context.chunks.map((chunk) => [chunk.citationLabel, chunk]),
    );
    const retrievedByChunk = new Map(
      retrieval.retrieval.chunks.map((chunk) => [chunk.chunkId, chunk]),
    );
    const chunkIds = [...new Set(retrieval.context.chunks.map((chunk) => chunk.chunkId))];

    let sourceRecords: SourceVerificationRecord[];

    try {
      sourceRecords = await this.repository.loadByChunkIds(chunkIds);
    } catch (error) {
      throw new EvidenceVerificationError(
        "Evidence sources could not be reloaded for verification.",
        { cause: error },
      );
    }

    const sourceByChunk = new Map(sourceRecords.map((source) => [source.chunkId, source]));
    const claims: VerifiedClaim[] = [];
    const rejectionReasons: Record<string, number> = {};
    let validEvidenceCount = 0;
    let invalidEvidenceCount = 0;

    for (const [claimIndex, claim] of answer.claims.entries()) {
      const evidence: VerifiedClaim["evidence"] = [];
      const discardedEvidence: VerifiedClaim["discardedEvidence"] = [];

      for (const proposed of claim.evidence) {
        const contextChunk = contextByLabel.get(proposed.citationLabel);
        const retrievedChunk = contextChunk
          ? retrievedByChunk.get(contextChunk.chunkId)
          : undefined;
        const source = contextChunk ? sourceByChunk.get(contextChunk.chunkId) : undefined;
        const reason = evidenceReason({
          citationExists: Boolean(contextChunk),
          retrievedThisRun: Boolean(retrievedChunk),
          source,
          documentMatches: Boolean(
            contextChunk &&
              retrievedChunk &&
              source &&
              contextChunk.documentId === retrievedChunk.documentId &&
              source.documentId === retrievedChunk.documentId,
          ),
          quoteInContext: Boolean(contextChunk?.contextText.includes(proposed.quote)),
          quoteInPersistedSource: Boolean(source?.chunkText.includes(proposed.quote)),
        });

        if (reason || !contextChunk || !retrievedChunk || !source) {
          const resolvedReason = reason ?? "unverified_evidence";
          invalidEvidenceCount += 1;
          rejectionReasons[resolvedReason] = (rejectionReasons[resolvedReason] ?? 0) + 1;
          discardedEvidence.push({
            citationLabel: proposed.citationLabel,
            quote: proposed.quote,
            reason: resolvedReason,
          });
          continue;
        }

        validEvidenceCount += 1;
        evidence.push({
          citationLabel: proposed.citationLabel,
          quoteText: proposed.quote,
          chunkId: source.chunkId,
          documentId: source.documentId,
          retrievalResultId: null,
          documentName: source.documentName,
          documentVersion: source.documentVersion,
          locator:
            Object.keys(source.locator).length > 0
              ? source.locator
              : locatorToJson(contextChunk.locator),
          supportScore: 100,
        });
      }

      const supportStatus =
        evidence.length === 0
          ? "unsupported"
          : discardedEvidence.length > 0
            ? "partial"
            : "full";

      claims.push({
        claimIndex,
        claimText: claim.claimText,
        claimType: claim.claimType,
        weight: claim.weight,
        supportStatus,
        evidence,
        discardedEvidence,
      });
    }

    const unsupportedClaimCount = claims.filter(
      (claim) => claim.supportStatus === "unsupported",
    ).length;
    const conflictClaimCount = claims.filter(
      (claim) => claim.supportStatus === "conflict",
    ).length;

    return {
      claims,
      validEvidenceCount,
      invalidEvidenceCount,
      unsupportedClaimCount,
      conflictClaimCount,
      details: {
        verified_chunk_count: sourceRecords.length,
        requested_chunk_count: chunkIds.length,
        rejection_reasons: rejectionReasons,
        verification_rules: [
          "retriever_membership",
          "ready_document",
          "document_identity",
          "prompt_context_exact_quote",
          "database_exact_quote",
        ],
      },
    };
  }
}
