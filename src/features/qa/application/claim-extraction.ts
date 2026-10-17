import { z } from "zod";

import { CLAIM_TYPES, type GeneratedClaim, type GeneratedStructuredAnswer } from "@/features/qa/domain/qa";

const generatedEvidenceSchema = z
  .object({
    citation_label: z.string().trim().regex(/^\[S\d+\]$/u),
    quote: z.string().min(1).max(2_000),
  })
  .strict();

const generatedClaimSchema = z
  .object({
    claim_text: z.string().trim().min(1).max(2_000),
    claim_type: z.enum(CLAIM_TYPES),
    weight: z.number().finite().min(0.1).max(10),
    evidence: z.array(generatedEvidenceSchema).max(12),
  })
  .strict();

export const generatedAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(12_000),
    claims: z.array(generatedClaimSchema).max(24),
    limitations: z.array(z.string().trim().min(1).max(500)).max(12),
    insufficient_evidence: z.boolean(),
  })
  .strict();

export type GeneratedAnswerPayload = z.infer<typeof generatedAnswerSchema>;

export const SAFE_INSUFFICIENT_EVIDENCE_ANSWER =
  "知识库中没有足够的可验证证据来回答该问题。";

export function toSafeInsufficientEvidenceAnswer(
  answer: GeneratedStructuredAnswer,
  limitation?: string,
): GeneratedStructuredAnswer {
  const limitations = [...answer.limitations];
  const normalizedLimitation = limitation?.trim();

  if (normalizedLimitation && !limitations.includes(normalizedLimitation)) {
    limitations.push(normalizedLimitation);
  }

  if (limitations.length === 0) {
    limitations.push("知识库证据不足，无法形成可验证回答。");
  }

  return {
    ...answer,
    answer: SAFE_INSUFFICIENT_EVIDENCE_ANSWER,
    limitations,
    insufficientEvidence: true,
  };
}

export class ClaimExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClaimExtractionError";
  }
}

function deduplicateEvidence(evidence: GeneratedAnswerPayload["claims"][number]["evidence"]) {
  const seen = new Set<string>();

  return evidence.filter((item) => {
    const key = `${item.citation_label}\u0000${item.quote}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/** Normalizes the model envelope before the Evidence Layer sees any claim. */
export class ClaimExtractionLayer {
  extract(value: unknown): GeneratedStructuredAnswer {
    const parsed = generatedAnswerSchema.safeParse(value);

    if (!parsed.success) {
      throw new ClaimExtractionError(
        "The generated answer did not satisfy the structured claim contract.",
        { cause: parsed.error },
      );
    }

    const claims: GeneratedClaim[] = [];
    const seenClaims = new Set<string>();

    for (const claim of parsed.data.claims) {
      const claimText = claim.claim_text.trim();
      const key = claimText.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");

      if (seenClaims.has(key)) {
        continue;
      }

      seenClaims.add(key);
      claims.push({
        claimText,
        claimType: claim.claim_type,
        weight: Math.round(claim.weight * 1000) / 1000,
        evidence: deduplicateEvidence(claim.evidence).map((item) => ({
          citationLabel: item.citation_label,
          quote: item.quote,
        })),
      });
    }

    const limitations = parsed.data.limitations
      .map((item) => item.trim())
      .filter((item, index, all) => item && all.indexOf(item) === index);

    const structuredAnswer: GeneratedStructuredAnswer = {
      answer: parsed.data.answer.trim(),
      claims,
      limitations,
      insufficientEvidence: parsed.data.insufficient_evidence,
    };

    const traceableClaimCount = claims.filter((claim) => claim.evidence.length > 0).length;

    if (traceableClaimCount === 0) {
      return toSafeInsufficientEvidenceAnswer(
        structuredAnswer,
        "生成结果未包含可追溯到检索证据的 Claim。",
      );
    }

    if (structuredAnswer.insufficientEvidence && structuredAnswer.limitations.length === 0) {
      structuredAnswer.limitations.push(
        "The retrieved knowledge does not fully support a reliable answer.",
      );
    }

    return structuredAnswer;
  }
}
