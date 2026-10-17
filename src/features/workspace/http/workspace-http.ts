import { randomUUID } from "node:crypto";

import { z } from "zod";

import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain";
import type { KnowledgeWorkspaceData } from "@/features/workspace/domain/workspace";
import { WorkspaceReadError } from "@/features/workspace/infrastructure/supabase-workspace-reader";

export class WorkspaceHttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceHttpError";
  }
}

export function createWorkspaceTraceId(): string {
  return randomUUID();
}

export function parseKnowledgeBaseId(value: string | null): string {
  const parsed = z.uuid().safeParse(value ?? DEFAULT_KNOWLEDGE_BASE_ID);

  if (!parsed.success) {
    throw new WorkspaceHttpError(
      "knowledge_base_id must be a valid UUID.",
      "INVALID_REQUEST",
      400,
    );
  }

  return parsed.data;
}

function documentToHttp(document: KnowledgeWorkspaceData["documents"][number]) {
  return {
    id: document.id,
    name: document.name,
    type: document.type,
    status: document.status,
    updated_at: document.updatedAt,
    uploaded_at: document.uploadedAt ?? null,
    created_at: document.createdAt ?? null,
    size: document.size,
    chunks: document.chunks,
    progress: document.progress ?? null,
  };
}

export function workspaceToHttp(data: KnowledgeWorkspaceData, traceId: string) {
  return {
    data_mode: data.dataMode ?? "live",
    knowledge_base: {
      id: data.knowledgeBaseId,
      name: data.knowledgeBaseName,
      description: data.knowledgeBaseDescription,
      health_score: data.healthScore,
    },
    documents: data.documents.map(documentToHttp),
    qa_runs: data.qaRuns.map((run) => ({
      id: run.id,
      query: run.query,
      task_type: run.taskType,
      confidence: run.confidence,
      status: run.status,
      created_at: run.createdAt,
      source_count: run.sourceCount,
    })),
    insights: data.insights.map((insight) => ({
      id: insight.id,
      type: insight.type,
      label: insight.label,
      question: insight.question,
      count: insight.count,
      score: insight.score ?? null,
      detail: insight.detail,
    })),
    latest_answer: {
      query: data.answer.query,
      task_type: data.answer.taskType,
      answer: data.answer.answer,
      limitations: data.answer.limitations,
      insufficient_evidence: data.answer.insufficientEvidence,
      confidence: data.answer.confidence,
      claims: data.answer.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        type: claim.type,
        support_status: claim.supportStatus,
        evidence_ids: claim.evidenceIds,
      })),
      evidence: data.answer.evidence.map((evidence) => ({
        id: evidence.id,
        citation_label: evidence.citationLabel,
        quote: evidence.quote,
        document_id: evidence.documentId,
        document_name: evidence.documentName,
        locator: evidence.locator,
        section: evidence.section ?? null,
        support_score: evidence.supportScore,
        relevance_score: evidence.relevanceScore,
      })),
      metrics: data.answer.metrics,
      run_id: data.answer.runId || null,
      created_at: data.answer.createdAt,
    },
    trace_id: traceId,
  };
}

export function workspaceErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof WorkspaceHttpError) {
    return Response.json(
      { error: { code: error.code, message: error.message, trace_id: traceId } },
      { status: error.status, headers: { "x-trace-id": traceId } },
    );
  }

  if (error instanceof WorkspaceReadError) {
    const status = error.code === "KNOWLEDGE_BASE_NOT_FOUND" ? 404 : 503;
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          trace_id: traceId,
        },
      },
      { status, headers: { "x-trace-id": traceId } },
    );
  }

  const configurationMissing = error instanceof Error && /Missing required server environment variable/u.test(error.message);
  console.error("Unhandled workspace read error", { traceId, error });

  return Response.json(
    {
      error: {
        code: configurationMissing ? "CONFIGURATION_MISSING" : "WORKSPACE_READ_FAILED",
        message: configurationMissing
          ? "The knowledge workspace is not connected to Supabase yet."
          : "The knowledge workspace could not be loaded.",
        trace_id: traceId,
      },
    },
    { status: configurationMissing ? 503 : 500, headers: { "x-trace-id": traceId } },
  );
}
