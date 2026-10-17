import type { KnowledgeWorkspaceData, WorkspaceAnswer } from "./types";

export type DemoScenarioId = "cross-document-analysis" | "knowledge-gap-refusal";

const retentionDocument = "01-q2-retention-review.md";
const releaseDocument = "03-product-release-notes.md";
const experimentDocument = "02-onboarding-experiment-brief.md";

const crossDocumentAnswer: WorkspaceAnswer = {
  query: "Analyze why early retention declined and separate strong evidence from directional signals.",
  taskType: "analysis",
  answer:
    "Q2 retention weakened alongside first-week activation: 90-day paid-logo retention was 84% versus a 91% prior-cohort average, while activation fell from 68% to 52%. Setup confusion was the most common coded friction. Release notes show a mandatory role-mapping step and a related support signal, while a controlled onboarding experiment later improved first-workflow publication by 16 percentage points. These sources support prioritizing onboarding clarity, but they do not prove the release caused the retention decline or that the experiment improved retention.",
  limitations: [
    "The retention review does not establish release causation, and the onboarding experiment is not mature enough to claim a 30- or 90-day retention effect.",
  ],
  insufficientEvidence: false,
  confidence: 79,
  claims: [
    {
      id: "demo-claim-retention",
      text: "Q2 2026 90-day paid-logo retention was 84%, compared with a 91% average for the January–March cohorts.",
      type: "fact",
      supportStatus: "full",
      evidenceIds: ["demo-evidence-retention"],
    },
    {
      id: "demo-claim-activation",
      text: "First-week activation declined from 68% to 52%, and onboarding setup confusion was the most frequently coded friction.",
      type: "analysis",
      supportStatus: "full",
      evidenceIds: ["demo-evidence-activation", "demo-evidence-churn-reasons"],
    },
    {
      id: "demo-claim-release-signal",
      text: "The release made role mapping mandatory; 41 of 73 tagged onboarding tickets asked which role to choose.",
      type: "analysis",
      supportStatus: "full",
      evidenceIds: ["demo-evidence-role-mapping", "demo-evidence-role-tickets"],
    },
    {
      id: "demo-claim-experiment",
      text: "A controlled guided-onboarding experiment lifted first-workflow publication by 16 percentage points, but did not establish a retention effect.",
      type: "fact",
      supportStatus: "full",
      evidenceIds: ["demo-evidence-experiment-lift", "demo-evidence-retention-limit"],
    },
  ],
  evidence: [
    {
      id: "demo-evidence-retention",
      citationLabel: "[S1]",
      quote: "The April 2026 trial-to-paid cohort reached 84% 90-day paid-logo retention, compared with a 91% average for the January–March 2026 cohorts.",
      documentId: "asteria-retention-q2-2026",
      documentName: retentionDocument,
      locator: "第 22 行 · Executive summary",
      section: "Executive summary",
      supportScore: 100,
      relevanceScore: 96,
    },
    {
      id: "demo-evidence-activation",
      citationLabel: "[S2]",
      quote: "First-week activation fell from 68% in the January–March 2026 baseline to 52% in the April–June 2026 cohort.",
      documentId: "asteria-retention-q2-2026",
      documentName: retentionDocument,
      locator: "第 24 行 · Executive summary",
      section: "Executive summary",
      supportScore: 100,
      relevanceScore: 94,
    },
    {
      id: "demo-evidence-churn-reasons",
      citationLabel: "[S3]",
      quote: "Among 126 coded churn interviews and support tickets, 44% cited onboarding setup confusion, 31% cited delayed integration setup, 15% cited the 10-seat minimum, and 10% cited other reasons.",
      documentId: "asteria-retention-q2-2026",
      documentName: retentionDocument,
      locator: "第 38 行 · Coded reasons",
      section: "Churn evidence · Coded reasons",
      supportScore: 100,
      relevanceScore: 91,
    },
    {
      id: "demo-evidence-role-mapping",
      citationLabel: "[S4]",
      quote: "RelayOS v3.8 made role mapping mandatory before a workspace could publish its first workflow. The change was introduced to ensure that the workflow owner had least-privilege access before execution.",
      documentId: "asteria-relayos-release-notes-v3-8",
      documentName: releaseDocument,
      locator: "第 22 行 · Role mapping change",
      section: "v3.8 · Role mapping change",
      supportScore: 100,
      relevanceScore: 88,
    },
    {
      id: "demo-evidence-role-tickets",
      citationLabel: "[S5]",
      quote: "From April 9 through May 31, Customer Success tagged 73 onboarding tickets as role-mapping related. Forty-one of those tickets asked which role to choose; the remaining tickets asked how to return to the prior setup step.",
      documentId: "asteria-relayos-release-notes-v3-8",
      documentName: releaseDocument,
      locator: "第 28 行 · Early support signal",
      section: "v3.8 · Early support signal",
      supportScore: 100,
      relevanceScore: 93,
    },
    {
      id: "demo-evidence-experiment-lift",
      citationLabel: "[S6]",
      quote: "The guided flow increased first-workflow publication within 48 hours from 51% in control to 67% in treatment, a 16 percentage-point lift.",
      documentId: "asteria-onboarding-experiment-2026-06",
      documentName: experimentDocument,
      locator: "第 28 行 · Observed results",
      section: "Observed results",
      supportScore: 100,
      relevanceScore: 92,
    },
    {
      id: "demo-evidence-retention-limit",
      citationLabel: "[S7]",
      quote: "The sample is not mature enough to claim a 30-day or 90-day retention effect. Retention should remain a follow-up metric after the cohort completes the observation window.",
      documentId: "asteria-onboarding-experiment-2026-06",
      documentName: experimentDocument,
      locator: "第 34 行 · Observed results",
      section: "Observed results",
      supportScore: 100,
      relevanceScore: 95,
    },
  ],
  metrics: [
    { key: "retrieval", label: "检索质量", score: 93, explanation: "预置示例分值，不代表线上评测结果。" },
    { key: "coverage", label: "证据覆盖度", score: 100, explanation: "演示中的每条 Claim 都关联到预置原文引用。" },
    { key: "match", label: "知识匹配度", score: 87, explanation: "预置示例分值，不代表线上评测结果。" },
    { key: "confidence", label: "回答可信度", score: 79, explanation: "保留因果边界，实验结果不外推为留存效果。" },
  ],
  runId: "demo-cross-document-analysis",
  createdAt: "预置场景",
};

const refusalAnswer: WorkspaceAnswer = {
  query: "What was Asteria Workcloud's ARR in July 2026?",
  taskType: "qa",
  answer:
    "I cannot verify Asteria Workcloud's July 2026 ARR from the available knowledge. The fictional source set does not contain a revenue figure, so I will not estimate or infer one.",
  limitations: [
    "The Asteria demo corpus contains no July 2026 ARR or revenue source. Add an approved financial document before asking for this figure.",
  ],
  insufficientEvidence: true,
  confidence: 12,
  claims: [],
  evidence: [],
  metrics: [
    { key: "retrieval", label: "检索质量", score: 14, explanation: "预置拒答示例：没有足够相关证据。" },
    { key: "coverage", label: "证据覆盖度", score: 0, explanation: "没有 Claim 获得有效 Evidence，因此不保留未经验证的回答。" },
    { key: "match", label: "知识匹配度", score: 10, explanation: "语料没有包含所问的收入数据。" },
    { key: "confidence", label: "回答可信度", score: 12, explanation: "预置示例分值，不代表线上评测结果。" },
  ],
  runId: "demo-knowledge-gap-refusal",
  createdAt: "预置场景",
};

export const demoScenarios: ReadonlyArray<{
  id: DemoScenarioId;
  label: string;
  detail: string;
  answer: WorkspaceAnswer;
}> = [
  {
    id: "cross-document-analysis",
    label: "跨文档分析",
    detail: "留存、产品变更与实验结果",
    answer: crossDocumentAnswer,
  },
  {
    id: "knowledge-gap-refusal",
    label: "知识缺口拒答",
    detail: "询问语料中不存在的 ARR 数据",
    answer: refusalAnswer,
  },
];

export const publicDemoWorkspaceData: KnowledgeWorkspaceData = {
  knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
  knowledgeBaseName: "Asteria Workcloud · 演示知识库",
  knowledgeBaseDescription: "虚构的 Asteria Workcloud / RelayOS 语料与预置 Evidence 场景。",
  healthScore: 84,
  documents: [
    { id: "asteria-retention-q2-2026", name: retentionDocument, type: "MD", status: "ready", updatedAt: "预置语料", size: "3.4 KB", chunks: 0 },
    { id: "asteria-onboarding-experiment-2026-06", name: experimentDocument, type: "MD", status: "ready", updatedAt: "预置语料", size: "2.3 KB", chunks: 0 },
    { id: "asteria-relayos-release-notes-v3-8", name: releaseDocument, type: "MD", status: "ready", updatedAt: "预置语料", size: "2.1 KB", chunks: 0 },
    { id: "asteria-support-escalation-sop-2026", name: "04-support-escalation-sop.md", type: "MD", status: "ready", updatedAt: "预置语料", size: "2.6 KB", chunks: 0 },
    { id: "asteria-competitor-brief-2026-07", name: "05-competitor-comparison.md", type: "MD", status: "ready", updatedAt: "预置语料", size: "2.2 KB", chunks: 0 },
  ],
  qaRuns: demoScenarios.map(({ answer }) => ({
    id: answer.runId,
    query: answer.query,
    taskType: answer.taskType,
    confidence: answer.confidence,
    status: answer.insufficientEvidence ? "insufficient_evidence" : "completed",
    createdAt: "预置场景",
    sourceCount: new Set(answer.evidence.map((item) => item.documentId)).size,
  })),
  insights: [
    {
      id: "demo-gap-arr",
      type: "gap",
      label: "知识缺口",
      question: refusalAnswer.query,
      count: 1,
      detail: "虚构语料没有提供 ARR 数据；演示拒答，不写入共享数据库。",
    },
  ],
  answer: crossDocumentAnswer,
};

export function getDemoScenario(id: DemoScenarioId): WorkspaceAnswer {
  return demoScenarios.find((scenario) => scenario.id === id)?.answer ?? crossDocumentAnswer;
}
