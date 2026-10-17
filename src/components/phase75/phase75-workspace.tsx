"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Phase5Icon } from "@/components/phase5/icons";
import { demoWorkspaceData } from "@/components/phase5/demo-data";
import { demoScenarios, type DemoScenarioId } from "@/components/phase5/demo-scenarios";
import type {
  ClaimSupportStatus,
  DocumentUploadReceipt,
  KnowledgeWorkspaceData,
  Phase5WorkspaceProps,
  WorkspaceAnswer,
  WorkspaceClaim,
  WorkspaceDocument,
  WorkspaceEvidence,
  WorkspaceMetric,
  WorkspaceQaRun,
} from "@/components/phase5/types";

type Page = "dashboard" | "assistant" | "evidence" | "documents";

export const EVIDENCE_SOURCE_ACTION_LABEL = "查看证据片段";
type QueryStage = "idle" | "understanding" | "retrieving" | "drafting" | "verifying";
type UploadActivityStatus = "uploading" | "queued" | "processing" | "ready" | "duplicate" | "failed";

type UploadActivity = {
  name: string;
  documentId?: string;
  status: UploadActivityStatus;
  progress?: number;
};

const QUERY_STAGE_STEPS: ReadonlyArray<{
  id: Exclude<QueryStage, "idle">;
  label: string;
  detail: string;
}> = [
  { id: "understanding", label: "任务理解", detail: "识别问题类型与意图" },
  { id: "retrieving", label: "知识检索", detail: "从 pgvector 召回依据" },
  { id: "drafting", label: "生成回答", detail: "整理结构化结论" },
  { id: "verifying", label: "证据核验", detail: "校验声明与原文" },
];

function mergeWorkspaceData(data?: Partial<KnowledgeWorkspaceData>): KnowledgeWorkspaceData {
  const emptyAnswer: WorkspaceAnswer = {
    ...demoWorkspaceData.answer,
    query: "尚无问答记录",
    answer: "上传文档并提出问题后，回答会显示在这里。",
    limitations: [],
    insufficientEvidence: false,
    confidence: 0,
    claims: [],
    evidence: [],
    metrics: [],
    runId: "",
    createdAt: "",
  };

  return {
    ...demoWorkspaceData,
    ...data,
    knowledgeBaseName: data?.knowledgeBaseName ?? "我的知识空间",
    knowledgeBaseDescription: data?.knowledgeBaseDescription ?? "仅你可以访问的企业知识与证据工作区。",
    healthScore: data?.healthScore ?? 0,
    documents: data?.documents ?? [],
    qaRuns: data?.qaRuns ?? [],
    insights: data?.insights ?? [],
    answer: data?.answer ?? emptyAnswer,
  };
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function taskTypeLabel(taskType: WorkspaceAnswer["taskType"]) {
  switch (taskType) {
    case "summary":
      return "总结";
    case "analysis":
      return "分析";
    case "compare":
      return "对比";
    case "recommend":
      return "建议";
    default:
      return "问答";
  }
}

function supportLabel(status: ClaimSupportStatus) {
  switch (status) {
    case "full":
      return "证据充分";
    case "partial":
      return "部分支持";
    case "conflict":
      return "存在冲突";
    default:
      return "需要复核";
  }
}

function supportTone(status: ClaimSupportStatus) {
  switch (status) {
    case "full":
      return "good";
    case "partial":
      return "warn";
    default:
      return "danger";
  }
}

function confidenceLevel(score: number) {
  if (score >= 85) return "高可信";
  if (score >= 70) return "中等可信";
  return "建议复核";
}

function confidenceExplanation(answer: WorkspaceAnswer) {
  const state = verificationState(answer);
  if (state === "verified") return "关键结论均有证据支持，且来源之间未发现明显冲突。";
  if (state === "review") return "部分结论的证据仍不充分，建议结合原文与知识缺口一起判断。";
  return "当前回答尚未完成证据核验，请勿直接用于关键决策。";
}

function documentTitle(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("user feedback")) return "用户反馈报告 · 2026 Q2";
  if (lower.includes("product requirements")) return "产品需求文档 · v2.1";
  if (lower.includes("customer health")) return "客户健康度与流失复盘";
  if (lower.includes("onboarding")) return "新用户引导手册";
  if (lower.includes("release notes")) return "产品版本记录 · 2026.06";
  return name;
}

function statusLabel(status: WorkspaceDocument["status"]) {
  switch (status) {
    case "ready":
      return "已就绪";
    case "processing":
      return "处理中";
    case "uploaded":
      return "等待处理";
    case "uploading":
      return "上传中";
    case "failed":
      return "需要处理";
    case "deleting":
      return "正在删除";
    default:
      return "处理中";
  }
}

function statusTone(status: WorkspaceDocument["status"]) {
  if (status === "ready") return "good";
  if (status === "failed") return "danger";
  return "progress";
}

function connectionLabel(mode: Phase5WorkspaceProps["connectionMode"], isLoading: boolean, demoMode: boolean) {
  if (demoMode) return "预置验证结果";
  if (isLoading) return "正在连接知识库";
  if (mode === "live") return "实时知识库";
  if (mode === "disconnected") return "演示数据模式";
  return "演示数据模式";
}

export function isDuplicateUploadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return String(error.code) === "DUPLICATE_DOCUMENT";
}

function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (isDuplicateUploadError(error) || error.message.toLowerCase().includes("already exists")) {
    return "知识库中已经存在相同内容的文档，请直接使用已有文档或修改内容后再上传。";
  }
  const message = error.message.toLowerCase();
  if (message.includes("knowledge workspace") || message.includes("supabase") || message.includes("fetch")) {
    return "暂时无法连接实时知识库，当前仍可使用演示数据浏览产品流程。";
  }
  if (message.includes("qa run") || message.includes("evidence-backed")) {
    return "暂时无法完成这次提问，请检查知识库连接后重试。";
  }
  return fallback;
}

function verificationState(answer: WorkspaceAnswer) {
  if (!answer.runId) return "pending" as const;
  if (
    answer.insufficientEvidence ||
    answer.evidence.length === 0 ||
    answer.claims.some((claim) => claim.supportStatus === "unsupported" || claim.supportStatus === "conflict")
  ) {
    return "review" as const;
  }
  return "verified" as const;
}

function VerificationBadge({ answer, demoMode = false }: { answer: WorkspaceAnswer; demoMode?: boolean }) {
  const state = verificationState(answer);
  return (
    <span className={cx("phase75-badge", state === "verified" ? "phase75-badge-good" : state === "review" ? "phase75-badge-warn" : "phase75-badge-muted")}>
      <span className="phase75-status-dot" />
      {demoMode ? (state === "verified" ? "预置 Evidence 已核验" : state === "review" ? "预置拒答场景" : "预置结果") : state === "verified" ? "已通过证据核验" : state === "review" ? "需要复核证据" : "等待证据"}
    </span>
  );
}

function ScoreRing({ score, size = "large" }: { score: number; size?: "small" | "large" }) {
  return (
    <div className={cx("phase75-score-ring", `phase75-score-ring-${size}`)} style={{ "--ring-score-target": `${score * 3.6}deg` } as CSSProperties}>
      <div className="phase75-score-ring-inner">
        <strong>{score}</strong>
        <span>分</span>
      </div>
    </div>
  );
}

function ProgressBar({ score, tone = "violet" }: { score: number; tone?: "violet" | "green" | "amber" }) {
  return (
    <div className="phase75-progress" aria-hidden="true">
      <span className={`phase75-progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

function Brand() {
  return (
    <div className="phase75-brand">
      <div className="phase75-brand-mark" aria-hidden="true"><span>N</span></div>
      <div>
        <strong>Novera AI</strong>
        <span>企业知识智能系统</span>
      </div>
    </div>
  );
}

function FileBadge({ type }: { type: WorkspaceDocument["type"] }) {
  return <span className={`phase75-file-badge phase75-file-${type.toLowerCase()}`}>{type}</span>;
}

function WorkspaceStatus({ mode, isLoading, demoMode }: { mode: Phase5WorkspaceProps["connectionMode"]; isLoading: boolean; demoMode: boolean }) {
  return <span className="phase75-connection"><span className={cx("phase75-connection-dot", (mode === "disconnected" || demoMode) && "phase75-connection-dot-muted")} />{connectionLabel(mode, isLoading, demoMode)}</span>;
}

export function sameDocumentName(documentName: string, fileName: string) {
  const normalize = (value: string) => value.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const normalizedDocumentName = normalize(documentName);
  const normalizedFileName = normalize(fileName);
  const fileNameWithoutExtension = normalizedFileName.replace(/\.[^.]+$/u, "");

  return normalizedDocumentName === normalizedFileName || normalizedDocumentName === fileNameWithoutExtension;
}

export function matchesUploadDocument(
  document: Pick<WorkspaceDocument, "id" | "name">,
  upload: Pick<UploadActivity, "documentId" | "name">,
) {
  return upload.documentId
    ? document.id === upload.documentId
    : sameDocumentName(document.name, upload.name);
}

function UploadStatus({ activity }: { activity: UploadActivity }) {
  const isTerminal = activity.status === "ready" || activity.status === "duplicate" || activity.status === "failed";
  const progress = activity.progress ?? (activity.status === "uploading" ? 28 : activity.status === "processing" ? 68 : 100);
  const label = activity.status === "uploading"
    ? "正在上传"
    : activity.status === "queued"
      ? "等待处理"
    : activity.status === "processing"
      ? "正在处理文档"
      : activity.status === "duplicate"
        ? "文档已存在"
      : activity.status === "ready"
        ? "文档已 READY"
        : "处理失败";
  const detail = activity.status === "uploading"
    ? "文件正在安全传输"
    : activity.status === "queued"
      ? "上传已确认，等待处理任务启动"
    : activity.status === "processing"
      ? "等待解析、切片与向量化完成"
      : activity.status === "duplicate"
        ? "知识库中已有相同内容，无需重复上传"
      : activity.status === "ready"
        ? "已进入可检索知识库，可以开始提问"
        : "请重新上传文件或检查文档格式";
  const iconName = activity.status === "uploading" ? "upload" : "activity";

  return (
    <div className={cx("phase75-upload-status", `phase75-upload-status-${activity.status}`)} role="status" aria-live="polite">
      <span className="phase75-upload-status-icon">
        {activity.status === "ready" ? (
          <Phase5Icon name="circle-check" />
        ) : activity.status === "failed" ? (
          <Phase5Icon name="warning" />
        ) : (
          <Phase5Icon name={iconName} />
        )}
      </span>
      <div className="phase75-upload-status-copy">
        <strong>{label}</strong>
        <span><b>{activity.name}</b> · {detail}</span>
      </div>
      <div className={cx("phase75-upload-status-track", isTerminal && "phase75-upload-status-track-terminal")} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

export function Phase75Workspace({
  data,
  onUpload,
  onQuerySubmit,
  onDemoScenario,
  connectionMode = "demo",
  connectionMessage,
  isLoading = false,
  userEmail,
  userName,
  onSignOut,
  onDocumentPreview,
  onDocumentDelete,
}: Phase5WorkspaceProps) {
  const workspace = useMemo(() => mergeWorkspaceData(data), [data]);
  const [page, setPage] = useState<Page>("dashboard");
  const [answer, setAnswer] = useState<WorkspaceAnswer>(workspace.answer);
  const [query, setQuery] = useState(workspace.answer.query);
  const [selectedClaimId, setSelectedClaimId] = useState(workspace.answer.claims[0]?.id ?? "");
  const [isRunning, setIsRunning] = useState(false);
  const [queryStage, setQueryStage] = useState<QueryStage>("idle");
  const [uploadActivity, setUploadActivity] = useState<UploadActivity | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [isLoadingDemoScenario, setIsLoadingDemoScenario] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<WorkspaceDocument | null>(null);
  const [documentPreview, setDocumentPreview] = useState<{ url: string; expiresAt: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuButtonRef = useRef<HTMLButtonElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const lastExternalAnswerKeyRef = useRef<string | null>(null);
  const isPublicDemo = data?.dataMode === "demo";
  const userInitial = userName?.trim().charAt(0).toUpperCase() || userEmail?.trim().charAt(0).toUpperCase() || "YL";
  const userLabel = userName?.trim() || userEmail || "Yuki Lin";

  const showNotice = useCallback((text: string, tone: "success" | "warning" = "success") => {
    setNotice({ text, tone });
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      accountMenuButtonRef.current?.focus();
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    const incomingAnswer = data?.answer;
    if (!incomingAnswer) return;
    const key = `${incomingAnswer.runId}:${incomingAnswer.createdAt}:${incomingAnswer.query}`;
    if (lastExternalAnswerKeyRef.current === key) return;
    lastExternalAnswerKeyRef.current = key;
    setAnswer(incomingAnswer);
    setSelectedClaimId(incomingAnswer.claims[0]?.id ?? "");
    setQuery(incomingAnswer.query);
  }, [data?.answer]);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => setNotice(null), 5_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!isRunning) return;

    const timers = [
      window.setTimeout(() => setQueryStage("retrieving"), 480),
      window.setTimeout(() => setQueryStage("drafting"), 1_050),
      window.setTimeout(() => setQueryStage("verifying"), 1_750),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [isRunning]);

  useEffect(() => {
    const dialog = previewDialogRef.current;
    if (!selectedDocument || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [selectedDocument]);

  useEffect(() => {
    if (!uploadActivity) return;
    // Never let an existing same-name document overwrite the state of a new
    // upload before the server returns its document id. Terminal local errors
    // are also authoritative until the user starts another upload.
    if (uploadActivity.status === "uploading" || uploadActivity.status === "failed" || uploadActivity.status === "duplicate" || uploadActivity.status === "ready") return;
    const matchingDocument = workspace.documents.find((document) => matchesUploadDocument(document, uploadActivity));
    if (!matchingDocument) return;

    const nextStatus: UploadActivityStatus = matchingDocument.status === "ready"
      ? "ready"
      : matchingDocument.status === "failed"
        ? "failed"
        : matchingDocument.status === "uploaded"
          ? "queued"
        : "processing";
    const nextProgress = matchingDocument.progress;
    if (nextStatus === uploadActivity.status && nextProgress === uploadActivity.progress) return;

    const timer = window.setTimeout(() => {
      setUploadActivity({
        name: uploadActivity.name,
        documentId: uploadActivity.documentId,
        status: nextStatus,
        ...(nextProgress === undefined ? {} : { progress: nextProgress }),
      });
      if (nextStatus === "ready") {
        showNotice(`${uploadActivity.name} 已处理完成，可以开始提问。`, "success");
      } else if (nextStatus === "failed") {
        showNotice(`${uploadActivity.name} 处理失败，请重新上传。`, "warning");
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [showNotice, uploadActivity, workspace.documents]);

  useEffect(() => {
    if (!uploadActivity || (uploadActivity.status !== "ready" && uploadActivity.status !== "failed")) return;

    const { name, status } = uploadActivity;
    const timer = window.setTimeout(() => {
      setUploadActivity((current) => current?.name === name && current.status === status ? null : current);
    }, 5_200);

    return () => window.clearTimeout(timer);
  }, [uploadActivity]);

  const selectedClaim = answer.claims.find((claim) => claim.id === selectedClaimId) ?? answer.claims[0];
  const selectedEvidence = selectedClaim
    ? answer.evidence.filter((evidence) => selectedClaim.evidenceIds.includes(evidence.id))
    : [];
  const readyDocuments = workspace.documents.filter((document) => document.status === "ready");
  const indexedChunks = workspace.documents.reduce((total, document) => total + document.chunks, 0);

  async function openDocument(document: WorkspaceDocument) {
    setSelectedDocument(document);
    setDocumentPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      if (!onDocumentPreview) throw new Error("文档预览暂不可用。");
      const preview = await onDocumentPreview(document);
      setDocumentPreview({ url: preview.downloadUrl, expiresAt: preview.expiresAt });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "文档预览暂不可用，请稍后重试。");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function removeDocument(document: WorkspaceDocument) {
    if (!onDocumentDelete || deletingDocumentId) return;
    setDeletingDocumentId(document.id);
    try {
      await onDocumentDelete(document);
      setConfirmDelete(false);
      setSelectedDocument(null);
      showNotice(`${document.name} 已从你的知识空间删除。`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "文档删除失败，请稍后重试。", "warning");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  function requestDocumentDelete(document: WorkspaceDocument) {
    setSelectedDocument(document);
    setDocumentPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setConfirmDelete(true);
  }

  function closeDocumentPreview() {
    setSelectedDocument(null);
    setDocumentPreview(null);
    setPreviewError(null);
    setConfirmDelete(false);
  }

  async function handleDemoScenario(id: DemoScenarioId) {
    if (!onDemoScenario || isLoadingDemoScenario) return;
    setIsLoadingDemoScenario(true);
    setPage("assistant");
    try {
      const nextAnswer = await onDemoScenario(id);
      setAnswer(nextAnswer);
      setQuery(nextAnswer.query);
      setSelectedClaimId(nextAnswer.claims[0]?.id ?? "");
      showNotice(nextAnswer.insufficientEvidence ? "已载入预置知识缺口拒答。" : "已载入预置跨文档分析。", "success");
    } catch {
      showNotice("暂时无法载入预置场景，请稍后重试。", "warning");
    } finally {
      setIsLoadingDemoScenario(false);
    }
  }

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleQuerySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isRunning) return;
    setIsRunning(true);
    setQueryStage("understanding");
    setPage("assistant");
    try {
      const result = await onQuerySubmit?.(trimmed);
      if (result) {
        setQueryStage("verifying");
        const nextAnswer: WorkspaceAnswer = {
          ...answer,
          ...result,
          query: result.query ?? trimmed,
          limitations: result.limitations ?? [],
          claims: result.claims ?? [],
          evidence: result.evidence ?? [],
          metrics: result.metrics ?? [],
        };
        setAnswer(nextAnswer);
        setQuery(nextAnswer.query);
        setSelectedClaimId(nextAnswer.claims[0]?.id ?? "");
        showNotice("回答已更新，证据链已同步。", "success");
      } else {
        showNotice("问题已记录。连接知识库后会生成完整回答。", "warning");
      }
    } catch (error) {
      showNotice(friendlyError(error, "暂时无法完成这次提问，请稍后重试。"), "warning");
    } finally {
      setIsRunning(false);
      setQueryStage("idle");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!onUpload) {
      showNotice("当前工作区未连接上传服务，文件没有进入知识库。", "warning");
      event.target.value = "";
      return;
    }

    setUploadActivity({ name: file.name, status: "uploading" });
    showNotice(`${file.name} 正在上传并进入知识处理流程。`, "success");
    void Promise.resolve()
      .then(() => onUpload(file))
      .then((receipt: void | DocumentUploadReceipt) => {
        setUploadActivity((current) => current?.name === file.name ? {
          name: file.name,
          documentId: receipt?.documentId,
          status: "processing",
        } : current);
        showNotice(`${file.name} 已上传，正在等待处理完成。`, "success");
      })
      .catch((error: unknown) => {
        const duplicate = isDuplicateUploadError(error);
        setUploadActivity((current) => current?.name === file.name
          ? { name: file.name, status: duplicate ? "duplicate" : "failed" }
          : current);
        showNotice(
          duplicate
            ? "该文档已经在知识库中，无需重复上传。"
            : friendlyError(error, "文件上传失败，请稍后重试。"),
          duplicate ? "success" : "warning",
        );
      });
    event.target.value = "";
  }

  return (
    <div className="phase75-shell">
      <a className="phase75-skip-link" href="#phase75-main">跳转到主要内容</a>
      <aside className={cx("phase75-sidebar", mobileNavOpen && "phase75-sidebar-open")} aria-label="主导航">
        <Brand />
        <button className="phase75-mobile-close" type="button" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><Phase5Icon name="close" /></button>
        <div className="phase75-workspace-switcher">
          <span className="phase75-workspace-avatar">{workspace.knowledgeBaseName.slice(0, 1)}</span>
          <span>{workspace.knowledgeBaseName}</span>
          <Phase5Icon name="chevron-down" />
        </div>
        <nav className="phase75-nav" aria-label="产品页面">
          <span className="phase75-nav-title">工作空间</span>
          <button type="button" className={cx("phase75-nav-item", page === "dashboard" && "phase75-nav-item-active")} onClick={() => navigate("dashboard")}><Phase5Icon name="layers" /><span>首页</span></button>
          <button type="button" className={cx("phase75-nav-item", page === "assistant" && "phase75-nav-item-active")} onClick={() => navigate("assistant")}><Phase5Icon name="spark" /><span>AI 助手</span></button>
          <button type="button" className={cx("phase75-nav-item", page === "evidence" && "phase75-nav-item-active")} onClick={() => navigate("evidence")}><Phase5Icon name="file-text" /><span>证据来源</span></button>
          {isPublicDemo ? null : <button type="button" className={cx("phase75-nav-item", page === "documents" && "phase75-nav-item-active")} onClick={() => navigate("documents")}><Phase5Icon name="document" /><span>我的文档</span><small>{readyDocuments.length}</small></button>}
        </nav>
        <div className="phase75-sidebar-health">
          <div><span className="phase75-health-pulse" />知识健康度<strong>{workspace.healthScore}%</strong></div>
          <ProgressBar score={workspace.healthScore} tone="green" />
          <p>基于文档就绪度与回答证据覆盖。</p>
        </div>
        <div className="phase75-sidebar-footer"><span className="phase75-user-avatar">{userInitial}</span><div title={userEmail || userLabel}><strong>{userLabel}</strong><span className="phase75-sidebar-email">{userEmail || "产品团队"}</span></div></div>
      </aside>
      {mobileNavOpen ? <button className="phase75-sidebar-overlay" type="button" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="phase75-main-column">
        <header className="phase75-topbar">
          <button className="phase75-mobile-menu" type="button" aria-label="打开导航" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Phase5Icon name="menu" /></button>
          <div className="phase75-breadcrumb"><span>Novera AI</span><Phase5Icon name="chevron-right" /><strong>{page === "dashboard" ? "首页" : page === "assistant" ? "AI 助手" : page === "documents" ? "我的文档" : "证据来源"}</strong></div>
          <div className="phase75-topbar-actions"><WorkspaceStatus mode={connectionMode} isLoading={isLoading} demoMode={isPublicDemo} />{userEmail ? <span className="phase75-topbar-email" title={userEmail}><span className="phase75-topbar-email-label">当前账号</span><strong>{userEmail}</strong></span> : null}<button type="button" className="phase75-icon-button" aria-label="通知" title="通知" onClick={() => showNotice("暂无新的知识提醒。", "success")}><Phase5Icon name="activity" /></button>{onSignOut ? <div className="phase75-account-menu" ref={accountMenuRef}><button ref={accountMenuButtonRef} type="button" className="phase75-topbar-user" aria-label="打开账号菜单" aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-controls="phase75-account-menu-panel" title={userEmail || userLabel} onClick={() => setAccountMenuOpen((open) => !open)}>{userInitial}</button><div id="phase75-account-menu-panel" className="phase75-account-menu-panel" role="menu" hidden={!accountMenuOpen}><div className="phase75-account-menu-identity"><span>当前登录账号</span><strong title={userEmail || userLabel}>{userEmail || userLabel}</strong></div><button type="button" role="menuitem" className="phase75-account-signout" onClick={() => { setAccountMenuOpen(false); onSignOut(); }}><Phase5Icon name="logout" /><span>退出账号</span></button></div></div> : <span className="phase75-topbar-user" title={userEmail || userLabel}>{userInitial}</span>}</div>
        </header>

        {notice ? <div className={cx("phase75-notice", notice.tone === "warning" && "phase75-notice-warning")} role="status"><Phase5Icon name={notice.tone === "warning" ? "warning" : "circle-check"} /><span>{notice.text}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><Phase5Icon name="close" /></button></div> : null}
        {isPublicDemo ? <div className="phase75-connection-banner" role="status"><Phase5Icon name="activity" /><span>演示数据 · Asteria Workcloud 虚构语料与预置验证结果；不调用实时模型或共享数据库。</span></div> : connectionMessage && connectionMode !== "live" ? <div className="phase75-connection-banner" role="status"><Phase5Icon name="activity" /><span>{connectionMode === "disconnected" ? "暂时无法连接你的私有知识空间；当前未加载其他用户或演示文档。" : isLoading ? "正在连接你的私有知识空间，请稍候。" : "当前暂未连接知识服务。"}</span></div> : null}
        {uploadActivity ? <UploadStatus activity={uploadActivity} /> : null}

        <main id="phase75-main" className="phase75-main">
          {isPublicDemo ? null : <input ref={fileInputRef} className="phase75-visually-hidden" type="file" accept=".pdf,.md,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} />}
          {page === "dashboard" ? <DashboardPage workspace={workspace} readyDocuments={readyDocuments} indexedChunks={indexedChunks} demoMode={isPublicDemo} onUpload={() => fileInputRef.current?.click()} onNavigate={navigate} onDemoScenario={handleDemoScenario} onOpenDocument={openDocument} /> : null}
          {page === "assistant" ? <AssistantPage answer={answer} query={query} isRunning={isRunning} queryStage={queryStage} selectedClaim={selectedClaim} demoMode={isPublicDemo} isLoadingDemoScenario={isLoadingDemoScenario} onDemoScenario={handleDemoScenario} onQueryChange={setQuery} onSubmit={handleQuerySubmit} onSelectClaim={(claim) => { setSelectedClaimId(claim.id); navigate("evidence"); }} onNavigate={navigate} /> : null}
          {page === "evidence" ? <EvidencePage answer={answer} claim={selectedClaim} evidence={selectedEvidence} demoMode={isPublicDemo} onBack={() => navigate("assistant")} onSelectClaim={setSelectedClaimId} /> : null}
          {page === "documents" ? <DocumentsPage documents={readyDocuments} isLoading={isLoading} onUpload={() => fileInputRef.current?.click()} onOpen={openDocument} onDelete={requestDocumentDelete} deletingDocumentId={deletingDocumentId} /> : null}
        </main>
      </div>
      {selectedDocument ? <dialog ref={previewDialogRef} className="phase75-document-dialog" aria-labelledby="document-dialog-title" onCancel={(event) => { event.preventDefault(); closeDocumentPreview(); }}>
        <header className="phase75-document-dialog-header"><div><span className="phase75-card-kicker">私有文档预览</span><h2 id="document-dialog-title">{selectedDocument.name}</h2></div><button type="button" className="phase75-icon-button" aria-label="关闭文档预览" title="关闭" onClick={closeDocumentPreview}><Phase5Icon name="close" /></button></header>
        <div className="phase75-document-dialog-meta"><span>{selectedDocument.type}</span><span>{selectedDocument.size}</span><span>上传于 {documentUploadTime(selectedDocument)}</span></div>
        {previewLoading ? <div className="phase75-document-preview-state" role="status">正在生成仅你可访问的预览链接…</div> : previewError ? <div className="phase75-document-preview-state phase75-document-preview-error" role="alert">{previewError}</div> : documentPreview ? <iframe className="phase75-document-preview-frame" src={documentPreview.url} title={`${selectedDocument.name} 文档内容`} /> : null}
        {confirmDelete ? <div className="phase75-delete-confirm" role="group" aria-label="确认删除文档"><span>删除后将从知识库和私有文件存储中移除，无法恢复。</span><button type="button" onClick={() => setConfirmDelete(false)}>取消</button><button type="button" className="phase75-delete-confirm-action" disabled={deletingDocumentId === selectedDocument.id} onClick={() => void removeDocument(selectedDocument)}>{deletingDocumentId === selectedDocument.id ? "正在删除…" : "确认删除"}</button></div> : <footer className="phase75-document-dialog-footer"><span>预览链接 {documentPreview ? `于 ${new Date(documentPreview.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 失效` : "仅在当前会话生成"}</span><button type="button" className="phase75-danger-button" disabled={!onDocumentDelete || deletingDocumentId === selectedDocument.id} onClick={() => setConfirmDelete(true)}><Phase5Icon name="trash" />删除文档</button></footer>}
      </dialog> : null}
    </div>
  );
}

function DashboardPage({ workspace, readyDocuments, indexedChunks, demoMode, onUpload, onNavigate, onDemoScenario, onOpenDocument }: { workspace: KnowledgeWorkspaceData; readyDocuments: WorkspaceDocument[]; indexedChunks: number; demoMode: boolean; onUpload: () => void; onNavigate: (page: Page) => void; onDemoScenario: (id: DemoScenarioId) => void; onOpenDocument: (document: WorkspaceDocument) => void }) {
  const verifiedSourceCount = new Set(workspace.answer.evidence.map((item) => item.documentId)).size;

  return (
    <div className="phase75-page phase75-dashboard-page phase75-dashboard-premium">
      <section className="phase75-dashboard-hero">
        <div className="phase75-dashboard-hero-copy">
          <span className="phase75-overline"><span className="phase75-overline-dot" />企业知识智能系统</span>
          <h1>帮助团队从企业知识中<br />获得可信 AI 答案</h1>
          <p>Novera AI 不只生成回答，还会验证每条结论，并把答案追溯到企业原文。</p>
          <div className="phase75-page-actions"><button className="phase75-button phase75-button-primary" type="button" onClick={() => onNavigate("assistant")}><Phase5Icon name="spark" />{demoMode ? "查看演示场景" : "开始提问"}</button>{demoMode ? null : <button className="phase75-button phase75-button-secondary" type="button" onClick={onUpload}><Phase5Icon name="upload" />上传知识</button>}</div>
          <div className="phase75-dashboard-promise"><Phase5Icon name="circle-check" /><span>每次回答都包含可信评分、回答依据与原文证据。</span></div>
        </div>
        <aside className="phase75-dashboard-answer-preview" aria-label="可信回答示例">
          <div className="phase75-dashboard-preview-head"><span><Phase5Icon name="spark" />{demoMode ? "预置回答场景" : "可信回答示例"}</span><VerificationBadge answer={workspace.answer} demoMode={demoMode} /></div>
          <span className="phase75-card-kicker">企业问题</span>
          <h2>{workspace.answer.query}</h2>
          <p>{workspace.answer.answer}</p>
          <div className="phase75-dashboard-preview-proof"><div><strong>{workspace.answer.confidence}</strong><span>可信评分</span></div><div><strong>{workspace.answer.evidence.length}</strong><span>支持证据</span></div><div><strong>{verifiedSourceCount}</strong><span>已验证来源</span></div></div>
          <button type="button" onClick={() => onNavigate("assistant")}>查看完整回答 <Phase5Icon name="arrow-up-right" /></button>
        </aside>
      </section>

      <section className="phase75-dashboard-flow" aria-label="核心使用流程">
        <div><span>01</span><Phase5Icon name="upload" /><strong>{demoMode ? "查看知识" : "上传知识"}</strong><small>{demoMode ? "浏览预置语料" : "沉淀企业文档"}</small></div><i />
        <div><span>02</span><Phase5Icon name="spark" /><strong>提出问题</strong><small>理解业务意图</small></div><i />
        <div><span>03</span><Phase5Icon name="activity" /><strong>生成答案</strong><small>基于知识分析</small></div><i />
        <div><span>04</span><Phase5Icon name="file-text" /><strong>验证证据</strong><small>回到来源原文</small></div>
      </section>

      <section className="phase75-dashboard-readiness">
        <div className="phase75-dashboard-readiness-copy"><span className="phase75-card-kicker">{demoMode ? "预置知识库" : "知识准备状态"}</span><h2>{demoMode ? "虚构语料与预置结果" : "企业知识已可以支持可信问答"}</h2><p>{demoMode ? "下方文档和指标均为作品集演示数据，不代表 Production 数据库或线上检索状态。" : `${readyDocuments.length} 份文档已完成处理，Novera AI 可从 ${indexedChunks} 个结构化知识片段中检索依据。`}</p></div>
        <div className="phase75-dashboard-readiness-metrics"><div><span>{demoMode ? "预置健康度" : "知识健康度"}</span><strong>{workspace.healthScore}%</strong></div><div><span>{demoMode ? "预置文档" : "已就绪文档"}</span><strong>{readyDocuments.length}</strong></div><div><span>{demoMode ? "引用 Evidence" : "可检索知识"}</span><strong>{demoMode ? workspace.answer.evidence.length : indexedChunks}<small>{demoMode ? " 条" : " 个片段"}</small></strong></div></div>
        {demoMode ? <span className="phase75-text-button" aria-label="公开演示只读">公开演示只读</span> : <button type="button" className="phase75-text-button" onClick={onUpload}>继续添加知识 <Phase5Icon name="plus" /></button>}
      </section>

      <section className="phase75-dashboard-activity">
        <div className="phase75-section-heading"><div><span className="phase75-card-kicker">{demoMode ? "演示数据" : "继续工作"}</span><h2>{demoMode ? "预置知识与问题" : "最近的知识与问题"}</h2></div><span>{demoMode ? "虚构语料 · 不写入共享数据库" : "保留真实知识处理状态与问答记录"}</span></div>
        <div className="phase75-dashboard-activity-grid">
          <div><div className="phase75-dashboard-subheading"><strong>{demoMode ? "预置知识" : "最近知识"}</strong>{demoMode ? null : <button type="button" onClick={() => onNavigate("documents")}>全部文档 <Phase5Icon name="chevron-right" /></button>}</div><div className="phase75-document-list">{(demoMode ? workspace.documents : readyDocuments).slice(0, 3).map((document) => <DocumentListItem key={document.id} document={document} onClick={demoMode ? undefined : () => onOpenDocument(document)} />)}</div></div>
          <div><div className="phase75-dashboard-subheading"><strong>{demoMode ? "预置问题场景" : "最近问题"}</strong><button type="button" onClick={() => onNavigate("assistant")}>查看回答 <Phase5Icon name="chevron-right" /></button></div><div className="phase75-question-list">{workspace.qaRuns.slice(0, 3).map((run) => <QuestionListItem key={run.id} run={run} onClick={() => { if (!demoMode) { onNavigate("assistant"); return; } onDemoScenario(run.status === "insufficient_evidence" ? "knowledge-gap-refusal" : "cross-document-analysis"); }} />)}</div></div>
        </div>
      </section>
    </div>
  );
}

function DocumentListItem({ document, onClick }: { document: WorkspaceDocument; onClick?: () => void }) {
  const tone = statusTone(document.status);
  const content = <><FileBadge type={document.type} /><div className="phase75-document-copy"><strong>{documentTitle(document.name)}</strong><span>{document.name} · {document.size}</span></div><div className={cx("phase75-document-status", `phase75-document-status-${tone}`)}><span />{statusLabel(document.status)}</div><Phase5Icon name="chevron-right" className="phase75-row-chevron" /></>;
  return onClick ? <button className="phase75-document-item phase75-document-item-button" type="button" onClick={onClick} aria-label={`查看文档 ${document.name}`}>{content}</button> : <div className="phase75-document-item">{content}</div>;
}

function documentUploadTime(document: WorkspaceDocument): string {
  const timestamp = document.uploadedAt ?? document.createdAt;
  if (!timestamp) return document.updatedAt || "时间未知";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? document.updatedAt || "时间未知"
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function DocumentsPage({ documents, isLoading, onUpload, onOpen, onDelete, deletingDocumentId }: { documents: WorkspaceDocument[]; isLoading: boolean; onUpload: () => void; onOpen: (document: WorkspaceDocument) => void; onDelete: (document: WorkspaceDocument) => void; deletingDocumentId: string | null }) {
  return <div className="phase75-page phase75-documents-page">
    <section className="phase75-documents-heading"><div><span className="phase75-overline"><span className="phase75-overline-dot" />个人知识空间</span><h1>我的文档</h1><p>仅显示已上传并处理成功、可检索的文档。</p></div><button className="phase75-button phase75-button-primary" type="button" onClick={onUpload}><Phase5Icon name="upload" />上传文档</button></section>
    <section className="phase75-documents-table" aria-labelledby="documents-list-heading">
      <div className="phase75-documents-table-heading"><div><h2 id="documents-list-heading">文档列表</h2><span>{documents.length} 份文档 · 仅此账号可访问</span></div><span>上传时间</span></div>
      {isLoading ? <div className="phase75-documents-empty" role="status">正在加载你的文档…</div> : documents.length === 0 ? <div className="phase75-documents-empty"><Phase5Icon name="document" /><strong>还没有处理成功的文档</strong><span>上传 PDF、Markdown 或 TXT，处理成功后会显示在这里。</span><button className="phase75-button phase75-button-secondary" type="button" onClick={onUpload}><Phase5Icon name="plus" />选择文档</button></div> : <div className="phase75-documents-rows">{documents.map((document) => <article className="phase75-managed-document" key={document.id}>
        <FileBadge type={document.type} />
        <div className="phase75-managed-document-copy"><strong title={document.name}>{document.name}</strong><span>{document.size} · {document.chunks ? `${document.chunks} 个知识片段` : "尚无知识片段"}</span></div>
        <span className={cx("phase75-document-status", `phase75-document-status-${statusTone(document.status)}`)}><i />{statusLabel(document.status)}</span>
        <time className="phase75-managed-document-time" dateTime={document.uploadedAt ?? document.createdAt ?? undefined}>{documentUploadTime(document)}</time>
        <div className="phase75-managed-document-actions"><button type="button" title="查看文档" aria-label={`查看文档 ${document.name}`} onClick={() => onOpen(document)}><Phase5Icon name="document" /><span>查看</span></button><button type="button" title="删除文档" aria-label={`删除文档 ${document.name}`} disabled={deletingDocumentId === document.id} onClick={() => onDelete(document)}><Phase5Icon name="trash" /><span>{deletingDocumentId === document.id ? "删除中" : "删除"}</span></button></div>
      </article>)}</div>}
    </section>
  </div>;
}

function QuestionListItem({ run, onClick }: { run: WorkspaceQaRun; onClick: () => void }) {
  return <button className="phase75-question-item" type="button" onClick={onClick}><span className={cx("phase75-question-status", run.status !== "completed" && "phase75-question-status-warn")}><Phase5Icon name={run.status === "completed" ? "circle-check" : "warning"} /></span><span className="phase75-question-copy"><strong>{run.query}</strong><small>{taskTypeLabel(run.taskType)} · {run.createdAt}</small></span><span className={cx("phase75-question-score", run.confidence < 70 && "phase75-question-score-warn")}>{run.confidence}<small>分</small></span><Phase5Icon name="chevron-right" className="phase75-row-chevron" /></button>;
}

function QueryPipeline({ stage }: { stage: QueryStage }) {
  if (stage === "idle") return null;

  const activeIndex = Math.max(0, QUERY_STAGE_STEPS.findIndex((step) => step.id === stage));
  const activeStep = QUERY_STAGE_STEPS[activeIndex] ?? QUERY_STAGE_STEPS[0];

  return (
    <section className="phase75-query-pipeline" role="status" aria-live="polite" aria-label="回答生成进度">
      <div className="phase75-query-pipeline-heading"><span className="phase75-query-pipeline-live" /><div><strong>{activeStep.label}</strong><span>{activeStep.detail}</span></div><small>实时处理</small></div>
      <div className="phase75-query-pipeline-steps">
        {QUERY_STAGE_STEPS.map((step, index) => {
          const completed = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div className="phase75-query-pipeline-step-wrap" key={step.id}>
              <div className={cx("phase75-query-pipeline-step", completed && "phase75-query-pipeline-step-done", active && "phase75-query-pipeline-step-active")}>
                <span className="phase75-query-pipeline-step-icon" aria-hidden="true">{completed ? <Phase5Icon name="check" /> : active ? <span className="phase75-query-pipeline-spinner" /> : <b>{String(index + 1).padStart(2, "0")}</b>}</span>
                <span><strong>{step.label}</strong><small>{active ? "进行中" : completed ? "已完成" : "等待中"}</small></span>
              </div>
              {index < QUERY_STAGE_STEPS.length - 1 ? <span className={cx("phase75-query-pipeline-connector", completed && "phase75-query-pipeline-connector-done")} aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssistantPage({ answer, query, isRunning, queryStage, selectedClaim, demoMode, isLoadingDemoScenario, onDemoScenario, onQueryChange, onSubmit, onSelectClaim, onNavigate }: { answer: WorkspaceAnswer; query: string; isRunning: boolean; queryStage: QueryStage; selectedClaim?: WorkspaceClaim; demoMode: boolean; isLoadingDemoScenario: boolean; onDemoScenario: (id: DemoScenarioId) => void; onQueryChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onSelectClaim: (claim: WorkspaceClaim) => void; onNavigate: (page: Page) => void }) {
  const verifiedSourceCount = new Set(answer.evidence.map((item) => item.documentId)).size;
  const supportedClaimCount = answer.claims.filter((claim) => claim.supportStatus === "full" || claim.supportStatus === "partial").length;
  const knowledgeGapCount = answer.limitations.length + (answer.insufficientEvidence ? 1 : 0);

  return (
    <div className="phase75-page phase75-assistant-page">
      <section className="phase75-assistant-intro phase75-assistant-intro-premium">
        <span className="phase75-overline"><span className="phase75-overline-dot" />可信知识问答</span>
        <h1>把企业知识，变成可验证的答案</h1>
        <p>Novera AI 先理解问题，再从企业知识中寻找依据，并对每条结论完成证据核验。</p>
        <div className="phase75-intelligence-path" aria-label="可信回答流程">
          <span><b>01</b>理解问题</span>
          <i />
          <span><b>02</b>检索知识</span>
          <i />
          <span><b>03</b>生成结论</span>
          <i />
          <span><b>04</b>核验证据</span>
        </div>
      </section>
      {demoMode ? (
        <section className="phase75-composer phase75-composer-premium" aria-label="预置演示场景">
          <div className="phase75-suggestion-row"><span><Phase5Icon name="book" />演示数据 · 虚构语料</span>{demoScenarios.map((scenario) => <button key={scenario.id} type="button" disabled={isLoadingDemoScenario} aria-busy={isLoadingDemoScenario} onClick={() => onDemoScenario(scenario.id)}>{isLoadingDemoScenario ? <span className="phase75-spinner" aria-label="正在载入" /> : scenario.label}</button>)}<em>预置验证结果 · 不调用实时模型</em></div>
          <p className="phase75-demo-scenario-detail">{demoScenarios.map((scenario) => `${scenario.label}：${scenario.detail}`).join(" · ")}</p>
        </section>
      ) : (
        <form className="phase75-composer phase75-composer-premium" onSubmit={onSubmit}>
          <div className="phase75-composer-input"><Phase5Icon name="spark" /><input aria-label="输入你的问题" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="输入一个需要企业知识支持的问题…" disabled={isRunning} /><button className="phase75-send-button" type="submit" disabled={isRunning || !query.trim()} aria-label="提交问题">{isRunning ? <span className="phase75-spinner" /> : <Phase5Icon name="arrow-up-right" />}</button></div>
          <div className="phase75-suggestion-row"><span><Phase5Icon name="book" />企业知识智能库</span><button type="button" onClick={() => onQueryChange("为什么最近用户流失增加？")}>分析用户流失原因</button><button type="button" onClick={() => onQueryChange("总结新用户在注册流程中遇到的阻力")}>总结注册流程阻力</button><button type="button" onClick={() => onQueryChange("激活流程发生了哪些变化？")}>对比激活流程变化</button><em>自动附带可信评分与来源证据</em></div>
        </form>
      )}
      <QueryPipeline stage={queryStage} />
      <article className={cx("phase75-answer-workspace", isRunning && "phase75-answer-workspace-querying")} aria-busy={isRunning}>
        <header className="phase75-query-context">
          <div>
            <span>用户问题</span>
            <h2>{answer.query || query}</h2>
          </div>
          <span className="phase75-task-badge">{taskTypeLabel(answer.taskType)}任务 · {answer.createdAt}</span>
        </header>

        <div className="phase75-answer-identity">
          <div className="phase75-ai-avatar"><Phase5Icon name="spark" /></div>
          <div><strong>Novera AI 分析结果</strong><span>{demoMode ? "虚构语料 · 预置回答与证据" : "基于当前已就绪的企业知识生成"}</span></div>
          <VerificationBadge answer={answer} demoMode={demoMode} />
        </div>

        <div className="phase75-answer-hero">
          <div className="phase75-answer-main">
            <div className="phase75-understanding-note"><Phase5Icon name="activity" /><span>已识别为「{taskTypeLabel(answer.taskType)}」任务，并从 {verifiedSourceCount} 份来源中核对 {answer.evidence.length} 条证据。</span></div>
            <span className="phase75-card-kicker">核心结论</span>
            <p>{answer.answer || "提交问题后，这里会显示基于证据的结构化回答。"}</p>
          </div>
          <aside className="phase75-trust-panel" aria-label="回答可信度摘要">
            <ScoreRing score={answer.confidence} />
            <div className="phase75-trust-panel-title"><strong>{confidenceLevel(answer.confidence)}</strong><span>可信评分</span></div>
            <p>{confidenceExplanation(answer)}</p>
            <dl>
              <div><dt>支持证据</dt><dd>{answer.evidence.length} 条</dd></div>
              <div><dt>已验证来源</dt><dd>{verifiedSourceCount} 份</dd></div>
              <div><dt>知识缺口</dt><dd>{knowledgeGapCount ? `${knowledgeGapCount} 项` : "未发现"}</dd></div>
            </dl>
          </aside>
        </div>

        <section className="phase75-why-trusted">
          <div className="phase75-section-heading">
            <div><span className="phase75-card-kicker">为什么可信</span><h2>评分不是结论，依据才是</h2></div>
            <span>{supportedClaimCount}/{answer.claims.length || 0} 条结论获得知识支持</span>
          </div>
          <MetricsStrip metrics={answer.metrics} />
          {answer.limitations.length ? <div className="phase75-knowledge-gap"><Phase5Icon name="warning" /><div><strong>已识别知识缺口</strong><span>{answer.limitations[0]}</span></div></div> : <div className="phase75-knowledge-gap phase75-knowledge-gap-clear"><Phase5Icon name="circle-check" /><div><strong>未发现影响结论的知识缺口</strong><span>当前知识库足以支持这次回答。</span></div></div>}
        </section>

        <section className="phase75-claims-section phase75-claims-section-integrated">
          <div className="phase75-section-heading"><div><span className="phase75-card-kicker">回答依据</span><h2>{answer.claims.length} 条可追溯结论</h2></div><span>选择任一结论，进入证据审计</span></div>
          <div className="phase75-claims-grid">{answer.claims.length ? answer.claims.map((claim, index) => <ClaimItem key={claim.id} claim={claim} index={index} selected={claim.id === selectedClaim?.id} onClick={() => onSelectClaim(claim)} />) : <div className="phase75-empty">回答生成后，会在这里显示可追溯结论。</div>}</div>
        </section>

        <section className="phase75-evidence-preview">
          <div className="phase75-section-heading"><div><span className="phase75-card-kicker">证据来源</span><h2>查看答案背后的原文</h2></div><button type="button" className="phase75-text-button" onClick={() => onNavigate("evidence")}>进入完整证据审计 <Phase5Icon name="arrow-up-right" /></button></div>
          <div className="phase75-evidence-preview-list">{answer.evidence.length ? answer.evidence.slice(0, 2).map((item) => <EvidencePreviewItem key={item.id} evidence={item} onClick={() => onNavigate("evidence")} />) : <div className="phase75-empty">当前回答还没有可查看的来源证据。</div>}</div>
        </section>
      </article>
    </div>
  );
}

function ClaimItem({ claim, index, selected, onClick }: { claim: WorkspaceClaim; index: number; selected: boolean; onClick: () => void }) {
  return <button className={cx("phase75-claim-item", selected && "phase75-claim-item-selected")} type="button" onClick={onClick}><span className="phase75-claim-number">{String(index + 1).padStart(2, "0")}</span><span className="phase75-claim-content"><span className="phase75-claim-meta"><span>{claim.type === "fact" ? "事实" : claim.type === "analysis" ? "分析" : claim.type === "comparison" ? "对比" : "建议"}</span><em className={`phase75-support-${supportTone(claim.supportStatus)}`}><span />{supportLabel(claim.supportStatus)}</em></span><strong>{claim.text}</strong><small><Phase5Icon name="file-text" />{claim.evidenceIds.length} 条来源依据</small></span><Phase5Icon name="chevron-right" className="phase75-row-chevron" /></button>;
}

function MetricsStrip({ metrics }: { metrics: WorkspaceMetric[] }) {
  return <div className="phase75-metrics-grid">{metrics.map((metric) => <div className="phase75-metric-item" key={metric.key}><div><span>{metric.label}</span><strong>{metric.score}<small>/100</small></strong></div><ProgressBar score={metric.score} tone={metric.score >= 88 ? "green" : metric.score >= 75 ? "violet" : "amber"} /><p>{metric.explanation}</p></div>)}</div>;
}

function EvidencePreviewItem({ evidence, onClick }: { evidence: WorkspaceEvidence; onClick: () => void }) {
  return (
    <button className="phase75-evidence-preview-item" type="button" onClick={onClick}>
      <span className="phase75-evidence-preview-citation">{evidence.citationLabel}</span>
      <span className="phase75-evidence-preview-copy">
        <strong>“{evidence.quote}”</strong>
        <small>{documentTitle(evidence.documentName)} · {evidence.locator}</small>
      </span>
      <span className="phase75-evidence-preview-score">匹配 {evidence.relevanceScore}%</span>
      <Phase5Icon name="chevron-right" />
    </button>
  );
}

function EvidencePage({ answer, claim, evidence, demoMode, onBack, onSelectClaim }: { answer: WorkspaceAnswer; claim?: WorkspaceClaim; evidence: WorkspaceEvidence[]; demoMode: boolean; onBack: () => void; onSelectClaim: (claimId: string) => void }) {
  const claimIndex = claim ? answer.claims.findIndex((item) => item.id === claim.id) + 1 : 0;
  const verifiedSourceCount = new Set(answer.evidence.map((item) => item.documentId)).size;

  return (
    <div className="phase75-page phase75-evidence-page">
      <button type="button" className="phase75-back-button" onClick={onBack}><Phase5Icon name="chevron-right" className="phase75-back-icon" />返回 AI 助手</button>
      <section className="phase75-evidence-intro phase75-evidence-intro-premium"><span className="phase75-overline"><span className="phase75-overline-dot" />{demoMode ? "演示数据 · 预置 Evidence 审计" : "证据优先 · 答案审计"}</span><h1>每一条结论，都能回到原文</h1><p>{demoMode ? "以下为虚构语料中的精确引用与行号示例，不是线上数据库记录。" : "逐条核对回答依据、原文引用与来源文档，判断这份 AI 答案是否值得采用。"}</p></section>

      <article className="phase75-audit-workspace">
        <header className="phase75-audit-header">
          <div><span>本次审计问题</span><h2>{answer.query}</h2></div>
          <VerificationBadge answer={answer} demoMode={demoMode} />
        </header>

        <section className="phase75-audit-answer">
          <div className="phase75-audit-answer-copy"><span className="phase75-card-kicker">AI 回答结论</span><p>{answer.answer}</p></div>
          <dl className="phase75-audit-summary">
            <div><dt>可信评分</dt><dd>{answer.confidence}<small>/100</small></dd></div>
            <div><dt>可追溯结论</dt><dd>{answer.claims.length}<small> 条</small></dd></div>
            <div><dt>已验证来源</dt><dd>{verifiedSourceCount}<small> 份</small></dd></div>
          </dl>
        </section>

        <div className="phase75-audit-chain" aria-label="答案审计流程"><span className="phase75-audit-step phase75-audit-step-done"><Phase5Icon name="check" /><b>回答结论</b></span><i /><span className="phase75-audit-step phase75-audit-step-active"><b>回答依据</b></span><i /><span className={cx("phase75-audit-step", evidence.length > 0 && "phase75-audit-step-done")}><Phase5Icon name="check" /><b>原文引用</b></span><i /><span className={cx("phase75-audit-step", evidence.length > 0 && "phase75-audit-step-done")}><Phase5Icon name="check" /><b>来源文档</b></span></div>

        <div className="phase75-audit-layout">
          <aside className="phase75-audit-claims" aria-label="回答依据列表">
            <div className="phase75-audit-subheading"><span className="phase75-card-kicker">回答依据</span><h2>选择一条结论核验</h2><p>每条结论都必须关联本次检索到的原文。</p></div>
            <div className="phase75-audit-claim-list">{answer.claims.map((item, index) => <button key={item.id} type="button" className={cx("phase75-audit-claim", item.id === claim?.id && "phase75-audit-claim-active")} onClick={() => onSelectClaim(item.id)}><span className="phase75-claim-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.text}</strong><small className={`phase75-support-${supportTone(item.supportStatus)}`}><i />{supportLabel(item.supportStatus)} · {item.evidenceIds.length} 条证据</small></span><Phase5Icon name="chevron-right" /></button>)}</div>
          </aside>

          <section className="phase75-audit-detail" key={claim?.id ?? "empty-claim"}>
            {claim ? <div className="phase75-audit-current-claim"><div><span className="phase75-card-kicker">正在审计 · 结论 {String(claimIndex).padStart(2, "0")}</span><h2>{claim.text}</h2></div><span className={`phase75-support-badge phase75-support-${supportTone(claim.supportStatus)}`}><i />{supportLabel(claim.supportStatus)}</span></div> : <div className="phase75-empty">当前回答还没有可查看的回答依据。</div>}
            <div className="phase75-audit-evidence-heading"><div><span className="phase75-card-kicker">原文引用</span><h3>{evidence.length} 条原文支持这条结论</h3></div><span>仅展示本次回答实际召回并通过核验的内容</span></div>
            <div className="phase75-audit-evidence-list">{evidence.length ? evidence.map((item) => <EvidenceDetail key={item.id} evidence={item} demoMode={demoMode} />) : <div className="phase75-empty">{answer.insufficientEvidence ? "该预置拒答没有可支持结论的证据；拒绝展示未核验的答案。" : "没有找到足够的原文证据。请回到 AI 助手复核这条回答。"}</div>}</div>
          </section>
        </div>
      </article>
    </div>
  );
}

function EvidenceDetail({ evidence, demoMode = false }: { evidence: WorkspaceEvidence; demoMode?: boolean }) {
  return <article className="phase75-evidence-detail phase75-audit-evidence"><div className="phase75-evidence-detail-top"><div className="phase75-citation"><span>{evidence.citationLabel}</span><span>{evidence.locator}</span></div><span className="phase75-evidence-verified"><Phase5Icon name="circle-check" />{demoMode ? "预置引用 · 原文可追溯" : "数据库原文已核验"}</span></div><blockquote>“{evidence.quote}”</blockquote><div className="phase75-evidence-detail-bottom"><div className="phase75-source-meta"><FileBadge type={evidence.documentName.toLowerCase().includes("feedback") ? "PDF" : "MD"} /><div><span className="phase75-source-label">来源文档</span><strong>{documentTitle(evidence.documentName)}</strong><small>{evidence.section ?? "来源文档"} · {evidence.locator}</small></div></div><div className="phase75-evidence-scores"><div><span>问题匹配</span><strong>{evidence.relevanceScore}%</strong><ProgressBar score={evidence.relevanceScore} tone="violet" /></div><div><span>结论支持</span><strong>{evidence.supportScore}%</strong><ProgressBar score={evidence.supportScore} tone="green" /></div></div><details className="phase75-source-disclosure"><summary className="phase75-source-button"><Phase5Icon name="arrow-up-right" />{EVIDENCE_SOURCE_ACTION_LABEL}</summary><div className="phase75-source-expanded"><span>数据库证据片段</span><blockquote>“{evidence.quote}”</blockquote><dl><div><dt>来源文档</dt><dd>{documentTitle(evidence.documentName)}</dd></div><div><dt>章节位置</dt><dd>{evidence.section ?? "来源文档"} · {evidence.locator}</dd></div><div><dt>核验状态</dt><dd>{demoMode ? "预置引用，可追溯" : "数据库原文已核验"}</dd></div></dl><p>这里展示的是本次回答实际引用并完成核验的入库原文片段。</p></div></details></div></article>;
}
