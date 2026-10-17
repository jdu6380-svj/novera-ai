import type { KnowledgeInsightService } from "@/features/knowledge-insights/application/knowledge-insight-service";
import type { UUID } from "@/domain";
import type { RetrievalEngine } from "@/features/retrieval/application/retrieval-engine";
import type { AnswerGenerator } from "./answer-generator";
import { toSafeInsufficientEvidenceAnswer } from "./claim-extraction";
import type { EvidenceVerificationLayer } from "./evidence-verifier";
import type { QualityEvaluator } from "./quality-evaluator";
import type { QaRunRepository } from "./qa-run-repository";
import type { QaPipelineResult, QaRunInput } from "@/features/qa/domain/qa";
import { estimateQaRunCost } from "./cost-estimator";

export interface QaRunServiceOptions {
  lowConfidenceThreshold?: number;
}

function nowMs(): number {
  return Date.now();
}

export class QaRunService {
  private readonly lowConfidenceThreshold: number;

  constructor(
    private readonly retrievalEngine: RetrievalEngine,
    private readonly answerGenerator: AnswerGenerator,
    private readonly evidenceVerifier: EvidenceVerificationLayer,
    private readonly qualityEvaluator: QualityEvaluator,
    private readonly repository: QaRunRepository,
    private readonly insightService?: KnowledgeInsightService,
    options: QaRunServiceOptions = {},
  ) {
    this.lowConfidenceThreshold = options.lowConfidenceThreshold ?? 60;
  }

  async execute(input: QaRunInput): Promise<QaPipelineResult> {
    const started = await this.repository.start({
      knowledgeBaseId: input.knowledgeBaseId,
      query: input.query,
      requestedTaskType: input.requestedTaskType,
      conversationId: input.conversationId,
    });
    const startedAt = nowMs();

    try {
      await this.repository.setStatus(started.qaRunId, "classifying");
      await this.repository.setStatus(started.qaRunId, "retrieving");
      const retrievalResult = await this.retrievalEngine.execute({
        query: input.query,
        knowledgeBaseId: input.knowledgeBaseId,
        requestedTaskType: input.requestedTaskType,
        topK: input.topK,
        similarityThreshold: input.similarityThreshold,
        documentIds: input.documentIds,
      });

      await this.repository.setStatus(started.qaRunId, "generating");
      const generated = await this.answerGenerator.generate({
        query: retrievalResult.query,
        taskUnderstanding: retrievalResult.taskUnderstanding,
        context: retrievalResult.context,
      });

      await this.repository.setStatus(started.qaRunId, "verifying");
      const verification = await this.evidenceVerifier.verify(
        generated.structuredAnswer,
        retrievalResult,
      );

      const finalAnswer =
        verification.validEvidenceCount === 0
          ? toSafeInsufficientEvidenceAnswer(
              generated.structuredAnswer,
              generated.structuredAnswer.insufficientEvidence
                ? undefined
                : "所有候选证据均未通过来源验证，原始模型回答已被安全降级。",
            )
          : generated.structuredAnswer;

      await this.repository.setStatus(started.qaRunId, "evaluating");
      const quality = this.qualityEvaluator.evaluate(
        retrievalResult,
        finalAnswer,
        verification,
      );
      const insufficientEvidence = finalAnswer.insufficientEvidence;
      const status = insufficientEvidence ? "insufficient_evidence" : "completed";
      const insufficientReason = insufficientEvidence
        ? finalAnswer.limitations.join(" ") ||
          "No claim received verified evidence from a READY source document."
        : null;
      const latencyMs = Math.max(0, nowMs() - startedAt);
      const cost = estimateQaRunCost({
        queryEmbeddingTokens: retrievalResult.retrieval.embedding.usageTokens,
        generationInputTokens: generated.inputTokens,
        generationOutputTokens: generated.outputTokens,
      });
      const persistedClaims = verification.claims;
      const selectedChunkIds = retrievalResult.context.chunks.map((chunk) => chunk.chunkId);
      const assistantMessage = await this.repository.complete({
        run: started,
        knowledgeBaseId: input.knowledgeBaseId,
        query: retrievalResult.query,
        requestedTaskType: input.requestedTaskType,
        classifiedTaskType: retrievalResult.taskUnderstanding.understoodTaskType,
        classifierConfidence: retrievalResult.taskUnderstanding.confidence,
        taskUnderstandingDetails: retrievalResult.taskUnderstanding.details,
        retrievalConfig: {
          requested_top_k: retrievalResult.retrieval.topK,
          similarity_threshold: retrievalResult.retrieval.similarityThreshold,
          context: {
            minimum_similarity: retrievalResult.context.config.minimumSimilarity,
            max_chunks: retrievalResult.context.config.maxChunks,
            max_chunks_per_document: retrievalResult.context.config.maxChunksPerDocument,
            max_tokens: retrievalResult.context.config.maxTokens,
            max_characters: retrievalResult.context.config.maxCharacters,
          },
        },
        retrievedChunks: retrievalResult.retrieval.chunks,
        selectedChunkIds,
        answer: finalAnswer,
        verification,
        claims: persistedClaims,
        quality,
        status,
        model: generated.model,
        promptVersion: generated.promptVersion,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        queryEmbeddingTokens: retrievalResult.retrieval.embedding.usageTokens,
        estimatedCostUsd: cost.estimatedCostUsd,
        pricingSource: cost.pricingSource,
        ratesUsdPerMillionTokens: cost.ratesUsdPerMillionTokens,
        latencyMs,
        insufficientReason,
      });

      const sources = [];
      const seenSources = new Set<string>();

      for (const claim of persistedClaims) {
        for (const evidence of claim.evidence) {
          const sourceKey = `${evidence.citationLabel}\u0000${evidence.documentId}`;

          if (seenSources.has(sourceKey)) {
            continue;
          }

          seenSources.add(sourceKey);
          sources.push({
            citationLabel: evidence.citationLabel,
            documentId: evidence.documentId,
            documentName: evidence.documentName,
            documentVersion: evidence.documentVersion,
            locator: evidence.locator,
          });
        }
      }

      const result: QaPipelineResult = {
        qaRunId: started.qaRunId,
        conversationId: started.conversationId,
        userMessageId: started.userMessageId,
        assistantMessageId: assistantMessage.assistantMessageId,
        query: retrievalResult.query,
        taskUnderstanding: {
          requestedTaskType: input.requestedTaskType,
          understoodTaskType: retrievalResult.taskUnderstanding.understoodTaskType,
          confidence: retrievalResult.taskUnderstanding.confidence,
          details: retrievalResult.taskUnderstanding.details,
        },
        answer: finalAnswer,
        claims: persistedClaims,
        sources,
        quality,
        status,
        limitations: finalAnswer.limitations,
        retrievedChunks: retrievalResult.retrieval.chunks,
        context: retrievalResult.context,
        runStats: {
          model: generated.model,
          promptVersion: generated.promptVersion,
          latencyMs,
          queryEmbeddingTokens: retrievalResult.retrieval.embedding.usageTokens,
          generationInputTokens: generated.inputTokens,
          generationOutputTokens: generated.outputTokens,
          estimatedCostUsd: cost.estimatedCostUsd,
          pricingSource: cost.pricingSource,
          ratesUsdPerMillionTokens: cost.ratesUsdPerMillionTokens,
        },
        persisted: true,
        retrievalEngineResult: retrievalResult,
      };

      await this.observeInsights(input.knowledgeBaseId, result);
      return result;
    } catch (error) {
      try {
        await this.repository.fail({
          qaRunId: started.qaRunId,
          userMessageId: started.userMessageId,
          errorCode: error instanceof Error ? error.name : "QA_RUN_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "The QA run failed unexpectedly.",
        });
      } catch (failureError) {
        console.error("Failed to persist QA failure state", {
          qaRunId: started.qaRunId,
          failureError,
        });
      }

      throw error;
    }
  }

  private async observeInsights(knowledgeBaseId: UUID, result: QaPipelineResult): Promise<void> {
    if (!this.insightService) {
      return;
    }

    const observations: Array<Parameters<KnowledgeInsightService["observe"]>[0]> = [
      {
        knowledgeBaseId,
        insightType: "frequent_question",
        questionText: result.query,
        latestQaRunId: result.qaRunId,
        confidenceScore: result.quality.confidence.score,
        details: { source: "qa_run", task_type: result.taskUnderstanding.understoodTaskType },
      },
    ];

    if (result.status === "insufficient_evidence") {
      observations.push(
        {
          knowledgeBaseId,
          insightType: "unanswered_question",
          questionText: result.query,
          latestQaRunId: result.qaRunId,
          confidenceScore: result.quality.confidence.score,
          details: { source: "qa_run", reason: result.answer.limitations },
        },
        {
          knowledgeBaseId,
          insightType: "knowledge_gap",
          questionText: result.query,
          latestQaRunId: result.qaRunId,
          confidenceScore: result.quality.confidence.score,
          details: { source: "qa_run", reason: "insufficient_evidence" },
        },
      );
    }

    if (result.quality.confidence.score < this.lowConfidenceThreshold) {
      observations.push({
        knowledgeBaseId,
        insightType: "low_confidence_answer",
        questionText: result.query,
        latestQaRunId: result.qaRunId,
        confidenceScore: result.quality.confidence.score,
        details: {
          source: "qa_run",
          threshold: this.lowConfidenceThreshold,
          quality: result.quality.details,
        },
      });
    }

    for (const observation of observations) {
      try {
        await this.insightService.observe(observation);
      } catch (error) {
        console.warn("Knowledge insight logging failed", { error, insightType: observation.insightType });
      }
    }
  }
}
