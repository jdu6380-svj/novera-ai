import type { SourceVerificationRecord } from "@/features/qa/domain/qa";

export interface EvidenceSourceRepository {
  loadByChunkIds(chunkIds: readonly string[]): Promise<SourceVerificationRecord[]>;
}

export type EvidenceSourceRepositoryErrorCode = "READ_FAILED" | "INVALID_RESPONSE";

export class EvidenceSourceRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: EvidenceSourceRepositoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EvidenceSourceRepositoryError";
  }
}
