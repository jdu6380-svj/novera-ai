import type { JsonObject } from "@/domain";
import type {
  EvidenceVerificationResult,
  GeneratedStructuredAnswer,
  QualityEvaluationResult,
  QualityMetric,
  VerifiedClaimSupportStatus,
} from "@/features/qa/domain/qa";
import type { RetrievalEngineResult } from "@/features/retrieval/application/retrieval-engine";

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals = 2): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function metric(score: number, explanation: string, details: JsonObject): QualityMetric {
  return { score: round(clamp(score)), explanation, details };
}

function supportFactor(status: VerifiedClaimSupportStatus): number {
  switch (status) {
    case "full":
      return 1;
    case "partial":
      return 0.6;
    case "conflict":
    case "unsupported":
      return 0;
  }
}

function retrievalMetric(retrieval: RetrievalEngineResult): QualityMetric {
  const selected = retrieval.context.chunks;

  if (selected.length === 0) {
    return metric(0, "No retrieved chunk passed the bounded context policy.", {
      selected_chunks: 0,
      retrieved_chunks: retrieval.retrieval.chunks.length,
      threshold: retrieval.retrieval.similarityThreshold,
    });
  }

  const similarities = selected.map((chunk) => clamp(chunk.similarityScore, 0, 1));
  const averageSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
  const topSimilarity = Math.max(...similarities);
  const threshold = retrieval.retrieval.similarityThreshold;
  const marginDenominator = Math.max(0.0001, 1 - threshold);
  const thresholdMargin =
    similarities.reduce(
      (sum, value) => sum + clamp((value - threshold) / marginDenominator, 0, 1),
      0,
    ) / similarities.length;
  const uniqueDocuments = new Set(selected.map((chunk) => chunk.documentId)).size;
  const diversity = Math.min(1, uniqueDocuments / Math.min(2, selected.length));
  const score =
    100 *
    (0.5 * averageSimilarity +
      0.25 * topSimilarity +
      0.15 * thresholdMargin +
      0.1 * diversity);

  return metric(
    score,
    `已从 ${uniqueDocuments} 个来源文档中选取 ${selected.length} 个证据片段，平均相似度为 ${round(averageSimilarity, 3)}。`,
    {
      average_similarity: round(averageSimilarity, 4),
      top_similarity: round(topSimilarity, 4),
      threshold_margin: round(thresholdMargin, 4),
      source_diversity: round(diversity, 4),
      selected_chunks: selected.length,
      retrieved_chunks: retrieval.retrieval.chunks.length,
      threshold,
    },
  );
}

function evidenceCoverageMetric(verification: EvidenceVerificationResult): QualityMetric {
  const totalWeight = verification.claims.reduce((sum, claim) => sum + claim.weight, 0);
  const supportedWeight = verification.claims.reduce(
    (sum, claim) => sum + claim.weight * supportFactor(claim.supportStatus),
    0,
  );
  const score = totalWeight > 0 ? (supportedWeight / totalWeight) * 100 : 0;

  return metric(
    score,
    totalWeight > 0
      ? `已验证证据支持 ${round(supportedWeight, 2)} / ${round(totalWeight, 2)} 个加权结论点。`
      : "生成的回答不包含可验证的结论。",
    {
      total_claim_weight: round(totalWeight, 3),
      supported_claim_weight: round(supportedWeight, 3),
      claim_count: verification.claims.length,
      unsupported_claim_count: verification.unsupportedClaimCount,
      conflict_claim_count: verification.conflictClaimCount,
      valid_evidence_count: verification.validEvidenceCount,
      invalid_evidence_count: verification.invalidEvidenceCount,
    },
  );
}

export class QualityEvaluator {
  evaluate(
    retrieval: RetrievalEngineResult,
    answer: GeneratedStructuredAnswer,
    verification: EvidenceVerificationResult,
  ): QualityEvaluationResult {
    const retrievalScore = retrievalMetric(retrieval);
    const evidenceCoverage = evidenceCoverageMetric(verification);
    const totalWeight = verification.claims.reduce((sum, claim) => sum + claim.weight, 0);
    const unsupportedWeight = verification.claims.reduce(
      (sum, claim) =>
        sum +
        (claim.supportStatus === "unsupported" || claim.supportStatus === "conflict"
          ? claim.weight
          : 0),
      0,
    );
    const unsupportedRatio = totalWeight > 0 ? unsupportedWeight / totalWeight : 1;
    const sufficiencyPenalty = answer.insufficientEvidence ? 0.65 : 1;
    const knowledgeMatchBase =
      0.55 * retrievalScore.score + 0.45 * evidenceCoverage.score;
    const knowledgeMatch = metric(
      knowledgeMatchBase * (1 - 0.25 * unsupportedRatio) * sufficiencyPenalty,
      answer.insufficientEvidence
        ? "检索到的知识只能部分支持当前回答，因此评分因证据充分性不足而保守封顶。"
        : "知识匹配度综合考虑检索相关性和结论级证据覆盖情况。",
      {
        retrieval_weight: 0.55,
        evidence_weight: 0.45,
        unsupported_claim_weight_ratio: round(unsupportedRatio, 4),
        insufficient_evidence_penalty: sufficiencyPenalty,
      },
    );
    const invalidEvidenceRatio =
      verification.validEvidenceCount + verification.invalidEvidenceCount > 0
        ? verification.invalidEvidenceCount /
          (verification.validEvidenceCount + verification.invalidEvidenceCount)
        : 1;
    let confidenceValue =
      0.25 * retrievalScore.score +
      0.4 * evidenceCoverage.score +
      0.35 * knowledgeMatch.score -
      25 * unsupportedRatio -
      10 * invalidEvidenceRatio;

    if (answer.insufficientEvidence) {
      confidenceValue = Math.min(confidenceValue, 49);
    }

    const confidence = metric(
      confidenceValue,
      answer.insufficientEvidence
        ? "由于最终证据层结果不足，回答置信度被限制在 50 分以下。"
        : "回答置信度综合考虑检索、证据覆盖、知识匹配和未获支持证据等因素，并采用保守计算。",
      {
        retrieval_weight: 0.25,
        evidence_coverage_weight: 0.4,
        knowledge_match_weight: 0.35,
        unsupported_claim_penalty: round(25 * unsupportedRatio, 2),
        invalid_evidence_penalty: round(10 * invalidEvidenceRatio, 2),
        insufficient_evidence_cap: answer.insufficientEvidence ? 49 : null,
      },
    );

    return {
      retrievalScore,
      evidenceCoverage,
      knowledgeMatch,
      confidence,
      details: {
        evaluator: "novera-quality-evaluator",
        evaluator_version: "1.0.0",
        insufficient_evidence: answer.insufficientEvidence,
        unsupported_claim_weight_ratio: round(unsupportedRatio, 4),
      },
    };
  }
}
