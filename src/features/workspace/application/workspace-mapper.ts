import type { JsonObject, JsonValue } from "@/domain";
import type {
  ClaimSupportStatus,
  InsightType,
  KnowledgeWorkspaceData,
  WorkspaceAnswer,
  WorkspaceDocument,
  WorkspaceMetric,
} from "@/features/workspace/domain/workspace";
import { metricExplanation, metricLabel } from "@/features/qa/application/metric-copy";

export interface WorkspaceKnowledgeBaseRow {
  id: string;
  name: string;
  description: string | null;
}

export interface WorkspaceDocumentRow {
  id: string;
  display_name: string;
  file_extension: string;
  file_size_bytes: number | string;
  status: string;
  progress_pct: number;
  chunk_count: number;
  uploaded_at?: string | null;
  created_at?: string | null;
  updated_at: string;
}

export interface WorkspaceQaRunRow {
  id: string;
  query: string;
  classified_task_type: string | null;
  requested_task_type: string;
  status: string;
  answer_payload: JsonObject | null;
  answer_text: string | null;
  metric_details: JsonObject | null;
  retrieval_score: number | string | null;
  evidence_coverage_score: number | string | null;
  knowledge_match_score: number | string | null;
  confidence_score: number | string | null;
  created_at: string;
}

export interface WorkspaceClaimRow {
  id: string;
  qa_run_id: string;
  claim_index: number;
  claim_text: string;
  claim_type: string | null;
  support_status: string;
}

export interface WorkspaceEvidenceRow {
  id: string;
  claim_id: string;
  qa_run_id: string;
  retrieval_result_id: string | null;
  document_id: string | null;
  citation_label: string;
  quote_text: string;
  locator: JsonObject | null;
  support_score: number | string | null;
  document_name_snapshot: string;
}

export interface WorkspaceRetrievalRow {
  id: string;
  relevance_score: number | string;
}

export interface WorkspaceInsightRow {
  id: string;
  insight_type: string;
  question_text: string;
  occurrence_count: number;
  confidence_score: number | string | null;
  details: JsonObject | null;
  last_observed_at: string;
}

export interface BuildWorkspaceDataInput {
  knowledgeBase: WorkspaceKnowledgeBaseRow;
  documents: WorkspaceDocumentRow[];
  qaRuns: WorkspaceQaRunRow[];
  claims: WorkspaceClaimRow[];
  evidence: WorkspaceEvidenceRow[];
  retrievalRows: WorkspaceRetrievalRow[];
  insights: WorkspaceInsightRow[];
  sourceDocumentIdsByRun: ReadonlyMap<string, ReadonlySet<string>>;
  now?: Date;
}

const TASK_TYPES = new Set(["qa", "summary", "analysis", "compare", "recommend"]);
const CLAIM_TYPES = new Set(["fact", "analysis", "comparison", "recommendation"]);
const SUPPORT_STATUSES = new Set(["full", "partial", "unsupported", "conflict"]);

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function score(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(clamp(parsed)) : 0;
}

function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function taskType(value: string | null | undefined): WorkspaceAnswer["taskType"] {
  return value && TASK_TYPES.has(value)
    ? (value as WorkspaceAnswer["taskType"])
    : "qa";
}

function claimType(value: string | null): WorkspaceAnswer["claims"][number]["type"] {
  return value && CLAIM_TYPES.has(value)
    ? (value as WorkspaceAnswer["claims"][number]["type"])
    : "fact";
}

function supportStatus(value: string): ClaimSupportStatus {
  return SUPPORT_STATUSES.has(value) ? (value as ClaimSupportStatus) : "unsupported";
}

function insightType(value: string): InsightType {
  switch (value) {
    case "knowledge_gap":
      return "gap";
    case "low_confidence_answer":
      return "low-confidence";
    case "unanswered_question":
      return "unanswered";
    default:
      return "frequent";
  }
}

function insightLabel(value: string): string {
  switch (value) {
    case "knowledge_gap":
      return "Knowledge gap";
    case "low_confidence_answer":
      return "Low confidence";
    case "unanswered_question":
      return "Unanswered";
    default:
      return "Frequent question";
  }
}

function documentType(extension: string): WorkspaceDocument["type"] {
  switch (extension.toLowerCase().replace(/^\./u, "")) {
    case "pdf":
      return "PDF";
    case "md":
    case "markdown":
      return "MD";
    case "doc":
    case "docx":
      return "DOCX";
    default:
      return "TXT";
  }
}

function documentStatus(value: string): WorkspaceDocument["status"] {
  switch (value) {
    case "uploading":
    case "uploaded":
    case "processing":
    case "ready":
    case "failed":
    case "deleting":
      return value;
    default:
      return "failed";
  }
}

export function formatFileSize(value: number | string): string {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function formatRelativeTime(value: string, now = new Date()): string {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) return "recently";

  const seconds = Math.round((timestamp - now.getTime()) / 1_000);
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  if (absoluteSeconds < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  if (absoluteSeconds < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp);
}

export function formatLocator(locator: JsonObject | null): string {
  if (!locator) return "Location unavailable";

  const section = stringValue(locator.section_path);
  const pageStart = typeof locator.page_start === "number" ? locator.page_start : null;
  const pageEnd = typeof locator.page_end === "number" ? locator.page_end : null;
  const lineStart = typeof locator.line_start === "number" ? locator.line_start : null;
  const lineEnd = typeof locator.line_end === "number" ? locator.line_end : null;
  const parts: string[] = [];

  if (section) parts.push(section);
  if (pageStart !== null) parts.push(pageEnd && pageEnd !== pageStart ? `Pages ${pageStart}–${pageEnd}` : `Page ${pageStart}`);
  if (lineStart !== null) parts.push(lineEnd && lineEnd !== lineStart ? `Lines ${lineStart}–${lineEnd}` : `Line ${lineStart}`);

  return parts.length > 0 ? parts.join(" · ") : "Source location";
}

function metric(
  key: WorkspaceMetric["key"],
  label: string,
  value: number | string | null,
  details: JsonObject | null,
  detailsKey: string,
): WorkspaceMetric {
  const metricDetails = objectValue(details?.[detailsKey]);

  return {
    key,
    label: metricLabel(key, label),
    score: score(value),
    explanation:
      metricExplanation(
        stringValue(metricDetails?.explanation) ??
          "This score is calculated from retrieval relevance and verified evidence coverage.",
      ),
  };
}

export function emptyWorkspaceAnswer(): WorkspaceAnswer {
  return {
    query: "",
    taskType: "qa",
    answer: "Run a QA check to turn retrieved knowledge into a traceable answer.",
    limitations: [],
    insufficientEvidence: false,
    confidence: 0,
    claims: [],
    evidence: [],
    metrics: [
      { key: "retrieval", label: "检索质量", score: 0, explanation: "尚未执行问答评测。" },
      { key: "coverage", label: "证据覆盖率", score: 0, explanation: "尚未执行问答评测。" },
      { key: "match", label: "知识匹配度", score: 0, explanation: "尚未执行问答评测。" },
      { key: "confidence", label: "回答置信度", score: 0, explanation: "尚未执行问答评测。" },
    ],
    runId: "",
    createdAt: "Not run yet",
  };
}

function buildAnswer(input: BuildWorkspaceDataInput, latestRun: WorkspaceQaRunRow | undefined): WorkspaceAnswer {
  if (!latestRun || latestRun.status === "failed") return emptyWorkspaceAnswer();

  const retrievalScoreById = new Map(
    input.retrievalRows.map((row) => [row.id, score(row.relevance_score)]),
  );
  const evidence = input.evidence
    .filter((item) => item.qa_run_id === latestRun.id)
    .map((item) => ({
      id: item.id,
      citationLabel: item.citation_label,
      quote: item.quote_text,
      documentId: item.document_id ?? "unknown-source",
      documentName: item.document_name_snapshot,
      locator: formatLocator(item.locator),
      section: stringValue(item.locator?.section_path),
      supportScore: score(item.support_score),
      relevanceScore: item.retrieval_result_id
        ? retrievalScoreById.get(item.retrieval_result_id) ?? 0
        : 0,
    }));
  const evidenceByClaim = new Map<string, string[]>();

  for (const item of input.evidence.filter((candidate) => candidate.qa_run_id === latestRun.id)) {
    evidenceByClaim.set(item.claim_id, [...(evidenceByClaim.get(item.claim_id) ?? []), item.id]);
  }

  const answerPayload = latestRun.answer_payload ?? {};
  const metrics = [
    metric("retrieval", "Retrieval quality", latestRun.retrieval_score, latestRun.metric_details, "retrieval_score"),
    metric("coverage", "Evidence coverage", latestRun.evidence_coverage_score, latestRun.metric_details, "evidence_coverage"),
    metric("match", "Knowledge match", latestRun.knowledge_match_score, latestRun.metric_details, "knowledge_match"),
    metric("confidence", "Answer confidence", latestRun.confidence_score, latestRun.metric_details, "confidence"),
  ];

  return {
    query: latestRun.query,
    taskType: taskType(latestRun.classified_task_type ?? latestRun.requested_task_type),
    answer: latestRun.answer_text ?? stringValue(answerPayload.answer) ?? emptyWorkspaceAnswer().answer,
    limitations: stringArray(answerPayload.limitations),
    insufficientEvidence:
      latestRun.status === "insufficient_evidence" || answerPayload.insufficient_evidence === true,
    confidence: score(latestRun.confidence_score),
    claims: input.claims
      .filter((claim) => claim.qa_run_id === latestRun.id)
      .sort((left, right) => left.claim_index - right.claim_index)
      .map((claim) => ({
        id: claim.id,
        text: claim.claim_text,
        type: claimType(claim.claim_type),
        supportStatus: supportStatus(claim.support_status),
        evidenceIds: evidenceByClaim.get(claim.id) ?? [],
      })),
    evidence,
    metrics,
    runId: latestRun.id,
    createdAt: formatRelativeTime(latestRun.created_at, input.now),
  };
}

function knowledgeHealth(input: BuildWorkspaceDataInput): number {
  if (input.documents.length === 0) return 0;

  const readyRatio = input.documents.filter((document) => document.status === "ready").length / input.documents.length;
  const scoredRuns = input.qaRuns
    .map((run) => score(run.confidence_score))
    .filter((value) => value > 0);
  const averageConfidence = scoredRuns.length > 0
    ? scoredRuns.reduce((total, value) => total + value, 0) / scoredRuns.length
    : readyRatio * 100;
  const openGapCount = input.insights.filter((item) =>
    item.insight_type === "knowledge_gap" || item.insight_type === "unanswered_question",
  ).length;

  return Math.round(clamp(readyRatio * 55 + averageConfidence * 0.45 - Math.min(20, openGapCount * 3)));
}

export function buildWorkspaceData(input: BuildWorkspaceDataInput): KnowledgeWorkspaceData {
  const latestAnswerRun = input.qaRuns.find((run) =>
    run.status === "completed" || run.status === "insufficient_evidence",
  );

  return {
    knowledgeBaseId: input.knowledgeBase.id,
    knowledgeBaseName: input.knowledgeBase.name,
    knowledgeBaseDescription:
      input.knowledgeBase.description ?? "Enterprise knowledge ready for evidence-backed analysis.",
    healthScore: knowledgeHealth(input),
    documents: input.documents.map((document) => ({
      id: document.id,
      name: document.display_name,
      type: documentType(document.file_extension),
      status: documentStatus(document.status),
      updatedAt: formatRelativeTime(document.updated_at, input.now),
      uploadedAt: document.uploaded_at,
      createdAt: document.created_at ?? null,
      size: formatFileSize(document.file_size_bytes),
      chunks: document.chunk_count,
      progress: document.progress_pct,
    })),
    qaRuns: input.qaRuns.map((run) => ({
      id: run.id,
      query: run.query,
      taskType: taskType(run.classified_task_type ?? run.requested_task_type),
      confidence: score(run.confidence_score),
      status:
        run.status === "completed" || run.status === "insufficient_evidence"
          ? run.status
          : "failed",
      createdAt: formatRelativeTime(run.created_at, input.now),
      sourceCount: input.sourceDocumentIdsByRun.get(run.id)?.size ?? 0,
    })),
    insights: input.insights.map((insight) => {
      const type = insightType(insight.insight_type);
      const reason = stringValue(insight.details?.reason);

      return {
        id: insight.id,
        type,
        label: insightLabel(insight.insight_type),
        question: insight.question_text,
        count: insight.occurrence_count,
        ...(insight.confidence_score === null
          ? {}
          : { score: score(insight.confidence_score) }),
        detail:
          reason ??
          (type === "frequent"
            ? `Observed ${insight.occurrence_count} times in the Knowledge Insight Log`
            : `Last observed ${formatRelativeTime(insight.last_observed_at, input.now)}`),
      };
    }),
    answer: buildAnswer(input, latestAnswerRun),
  };
}
