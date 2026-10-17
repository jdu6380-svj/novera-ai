"use client";

import { DEFAULT_KNOWLEDGE_BASE_ID, type JsonObject } from "@/domain";
import { uploadDocument } from "@/features/documents/client/upload-document";
import { authorizedFetch } from "@/infrastructure/supabase/browser-client";
import { metricExplanation, metricLabel } from "@/features/qa/application/metric-copy";
import type {
  KnowledgeWorkspaceData,
  WorkspaceAnswer,
  WorkspaceMetric,
} from "@/features/workspace/domain/workspace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is missing from the server response.`);
  return value;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorMessage(body: unknown, fallback: string): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  return typeof error?.message === "string" ? error.message : fallback;
}

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

async function jsonResponse(response: Response, fallback: string): Promise<unknown> {
  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const rawError = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    throw new WorkspaceApiError(
      errorMessage(body, fallback),
      response.status,
      typeof rawError?.code === "string" ? rawError.code : undefined,
    );
  }
  return body;
}

function locatorLabel(value: unknown): string {
  if (!isRecord(value)) return "Source location";
  const parts: string[] = [];
  const section = string(value.section_path);
  const pageStart = number(value.page_start, Number.NaN);
  const pageEnd = number(value.page_end, Number.NaN);
  const lineStart = number(value.line_start, Number.NaN);
  const lineEnd = number(value.line_end, Number.NaN);

  if (section) parts.push(section);
  if (Number.isFinite(pageStart)) {
    parts.push(Number.isFinite(pageEnd) && pageEnd !== pageStart ? `Pages ${pageStart}–${pageEnd}` : `Page ${pageStart}`);
  }
  if (Number.isFinite(lineStart)) {
    parts.push(Number.isFinite(lineEnd) && lineEnd !== lineStart ? `Lines ${lineStart}–${lineEnd}` : `Line ${lineStart}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Source location";
}

export function workspaceDataFromHttp(value: unknown): KnowledgeWorkspaceData {
  const body = record(value, "Workspace payload");
  const knowledgeBase = record(body.knowledge_base, "Knowledge base");
  const latestAnswer = record(body.latest_answer, "Latest answer");

  return {
    dataMode: body.data_mode === "demo" ? "demo" : "live",
    knowledgeBaseId: string(knowledgeBase.id, DEFAULT_KNOWLEDGE_BASE_ID),
    knowledgeBaseName: string(knowledgeBase.name, "Novera AI Knowledge Base"),
    knowledgeBaseDescription: string(
      knowledgeBase.description,
      "Enterprise knowledge ready for evidence-backed analysis.",
    ),
    healthScore: number(knowledgeBase.health_score),
    documents: Array.isArray(body.documents)
      ? body.documents.filter(isRecord).map((document) => ({
          id: string(document.id),
          name: string(document.name),
          type: string(document.type, "TXT") as KnowledgeWorkspaceData["documents"][number]["type"],
          status: string(document.status, "failed") as KnowledgeWorkspaceData["documents"][number]["status"],
          updatedAt: string(document.updated_at, "recently"),
          uploadedAt: typeof document.uploaded_at === "string" ? document.uploaded_at : null,
          createdAt: typeof document.created_at === "string" ? document.created_at : null,
          size: string(document.size, "0 B"),
          chunks: number(document.chunks),
          ...(document.progress === null ? {} : { progress: number(document.progress) }),
        }))
      : [],
    qaRuns: Array.isArray(body.qa_runs)
      ? body.qa_runs.filter(isRecord).map((run) => ({
          id: string(run.id),
          query: string(run.query),
          taskType: string(run.task_type, "qa") as KnowledgeWorkspaceData["qaRuns"][number]["taskType"],
          confidence: number(run.confidence),
          status: string(run.status, "failed") as KnowledgeWorkspaceData["qaRuns"][number]["status"],
          createdAt: string(run.created_at, "recently"),
          sourceCount: number(run.source_count),
        }))
      : [],
    insights: Array.isArray(body.insights)
      ? body.insights.filter(isRecord).map((insight) => ({
          id: string(insight.id),
          type: string(insight.type, "frequent") as KnowledgeWorkspaceData["insights"][number]["type"],
          label: string(insight.label),
          question: string(insight.question),
          count: number(insight.count),
          ...(insight.score === null ? {} : { score: number(insight.score) }),
          detail: string(insight.detail),
        }))
      : [],
    answer: {
      query: string(latestAnswer.query),
      taskType: string(latestAnswer.task_type, "qa") as WorkspaceAnswer["taskType"],
      answer: string(latestAnswer.answer),
      limitations: stringArray(latestAnswer.limitations),
      insufficientEvidence: latestAnswer.insufficient_evidence === true,
      confidence: number(latestAnswer.confidence),
      claims: Array.isArray(latestAnswer.claims)
        ? latestAnswer.claims.filter(isRecord).map((claim) => ({
            id: string(claim.id),
            text: string(claim.text),
            type: string(claim.type, "fact") as WorkspaceAnswer["claims"][number]["type"],
            supportStatus: string(claim.support_status, "unsupported") as WorkspaceAnswer["claims"][number]["supportStatus"],
            evidenceIds: stringArray(claim.evidence_ids),
          }))
        : [],
      evidence: Array.isArray(latestAnswer.evidence)
        ? latestAnswer.evidence.filter(isRecord).map((evidence) => ({
            id: string(evidence.id),
            citationLabel: string(evidence.citation_label),
            quote: string(evidence.quote),
            documentId: string(evidence.document_id),
            documentName: string(evidence.document_name),
            locator: string(evidence.locator, "Source location"),
            ...(typeof evidence.section === "string" ? { section: evidence.section } : {}),
            supportScore: number(evidence.support_score),
            relevanceScore: number(evidence.relevance_score),
          }))
        : [],
      metrics: Array.isArray(latestAnswer.metrics)
        ? (latestAnswer.metrics.filter(isRecord).map((metric) => ({
            key: string(metric.key, "retrieval") as WorkspaceMetric["key"],
            label: metricLabel(
              string(metric.key, "retrieval") as WorkspaceMetric["key"],
              string(metric.label),
            ),
            score: number(metric.score),
            explanation: metricExplanation(string(metric.explanation)),
          })) as WorkspaceMetric[])
        : [],
      runId: string(latestAnswer.run_id),
      createdAt: string(latestAnswer.created_at, "recently"),
    },
  };
}

export function qaAnswerFromHttp(value: unknown): WorkspaceAnswer {
  const body = record(value, "QA payload");
  const answer = record(body.answer, "QA answer");
  const quality = record(body.quality_scores, "Quality scores");
  const taskUnderstanding = record(body.task_understanding, "Task understanding");
  const evidenceById = new Map<string, WorkspaceAnswer["evidence"][number]>();
  const claims = Array.isArray(answer.claims)
    ? answer.claims.filter(isRecord).map((claim, claimOffset) => {
        const claimIndex = number(claim.claim_index, claimOffset);
        const evidenceIds: string[] = [];

        if (Array.isArray(claim.evidence)) {
          for (const [evidenceOffset, rawEvidence] of claim.evidence.filter(isRecord).entries()) {
            const evidenceId = `${string(body.qa_run_id, "qa")}:${claimIndex}:${evidenceOffset}`;
            const locator = isRecord(rawEvidence.locator)
              ? (rawEvidence.locator as JsonObject)
              : {};
            evidenceById.set(evidenceId, {
              id: evidenceId,
              citationLabel: string(rawEvidence.citation_label),
              quote: string(rawEvidence.quote),
              documentId: string(rawEvidence.document_id),
              documentName: string(rawEvidence.document_name),
              locator: locatorLabel(locator),
              ...(typeof locator.section_path === "string"
                ? { section: locator.section_path }
                : {}),
              supportScore: number(rawEvidence.support_score),
              relevanceScore: number(rawEvidence.relevance_score),
            });
            evidenceIds.push(evidenceId);
          }
        }

        return {
          id: `${string(body.qa_run_id, "qa")}:claim:${claimIndex}`,
          text: string(claim.claim_text),
          type: string(claim.claim_type, "fact") as WorkspaceAnswer["claims"][number]["type"],
          supportStatus: string(claim.support_status, "unsupported") as WorkspaceAnswer["claims"][number]["supportStatus"],
          evidenceIds,
        };
      })
    : [];
  const metricFrom = (
    key: WorkspaceMetric["key"],
    label: string,
    raw: unknown,
  ): WorkspaceMetric => {
    const metric = isRecord(raw) ? raw : {};
    return {
      key,
      label,
      score: number(metric.score),
      explanation: metricExplanation(string(metric.explanation, "No explanation was returned.")),
    };
  };
  const metrics = [
    metricFrom("retrieval", "检索质量", quality.retrieval_score),
    metricFrom("coverage", "证据覆盖率", quality.evidence_coverage),
    metricFrom("match", "知识匹配度", quality.knowledge_match),
    metricFrom("confidence", "回答置信度", quality.confidence),
  ];

  return {
    query: string(body.query),
    taskType: string(taskUnderstanding.task_type, "qa") as WorkspaceAnswer["taskType"],
    answer: string(answer.answer),
    limitations: stringArray(answer.limitations),
    insufficientEvidence: answer.insufficient_evidence === true,
    confidence: metrics[3]?.score ?? 0,
    claims,
    evidence: [...evidenceById.values()],
    metrics,
    runId: string(body.qa_run_id),
    createdAt: "Just now",
  };
}

export async function loadWorkspace(
  knowledgeBaseId: string = DEFAULT_KNOWLEDGE_BASE_ID,
  signal?: AbortSignal,
): Promise<KnowledgeWorkspaceData> {
  const endpoint = new URL("/api/v1/workspace", window.location.origin);
  endpoint.searchParams.set("knowledge_base_id", knowledgeBaseId);
  const response = await authorizedFetch(endpoint, { signal, cache: "no-store" });
  return workspaceDataFromHttp(
    await jsonResponse(response, "The knowledge workspace could not be loaded."),
  );
}

export async function submitQaRun(
  query: string,
  knowledgeBaseId: string = DEFAULT_KNOWLEDGE_BASE_ID,
): Promise<WorkspaceAnswer> {
  const response = await authorizedFetch("/api/v1/qa/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      knowledge_base_id: knowledgeBaseId,
      task_type: "auto",
    }),
  });

  return qaAnswerFromHttp(
    await jsonResponse(response, "The evidence-backed QA run could not be completed."),
  );
}

export async function submitDemoScenario(id: "cross-document-analysis" | "knowledge-gap-refusal"): Promise<WorkspaceAnswer> {
  const response = await authorizedFetch(`/api/v1/demo/scenarios/${id}`, { cache: "no-store" });
  const body = await jsonResponse(response, "The preset demo scenario could not be loaded.");
  const mapped = workspaceDataFromHttp(body);
  return { ...mapped.answer, runId: mapped.answer.runId || `demo-${id}` };
}

export async function uploadWorkspaceDocument(
  file: File,
  knowledgeBaseId: string = DEFAULT_KNOWLEDGE_BASE_ID,
): Promise<{ documentId: string }> {
  const result = await uploadDocument(file, { knowledgeBaseId });
  return { documentId: result.document.id };
}

export interface DocumentPreviewResponse {
  document: {
    id: string;
    name: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string | null;
    created_at: string;
  };
  download_url: string;
  expires_at: string;
}

export async function loadDocumentPreview(documentId: string): Promise<DocumentPreviewResponse> {
  const response = await authorizedFetch(
    `/api/v1/documents/${encodeURIComponent(documentId)}/download`,
    { cache: "no-store" },
  );
  return (await jsonResponse(response, "文档预览链接暂时无法生成。")) as DocumentPreviewResponse;
}

export async function deleteWorkspaceDocument(documentId: string): Promise<void> {
  const response = await authorizedFetch(`/api/v1/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
  await jsonResponse(response, "文档删除失败，请稍后重试。");
}
