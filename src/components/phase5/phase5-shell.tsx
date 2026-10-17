"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { demoWorkspaceData } from "./demo-data";
import { Phase5Icon, type Phase5IconName } from "./icons";
import type {
  ClaimSupportStatus,
  KnowledgeWorkspaceData,
  Phase5WorkspaceProps,
  WorkspaceAnswer,
  WorkspaceClaim,
  WorkspaceDocument,
  WorkspaceEvidence,
  WorkspaceInsight,
  WorkspaceMetric,
  WorkspaceQaRun,
} from "./types";

function mergeWorkspaceData(
  data?: Partial<KnowledgeWorkspaceData>,
): KnowledgeWorkspaceData {
  return {
    ...demoWorkspaceData,
    ...data,
    documents: data?.documents ?? demoWorkspaceData.documents,
    qaRuns: data?.qaRuns ?? demoWorkspaceData.qaRuns,
    insights: data?.insights ?? demoWorkspaceData.insights,
    answer: data?.answer ?? demoWorkspaceData.answer,
  };
}

const navItems: Array<{ id: string; label: string; icon: Phase5IconName }> = [
  { id: "workspace", label: "Knowledge workspace", icon: "layers" },
  { id: "documents", label: "Documents", icon: "file-text" },
  { id: "qa-runs", label: "QA runs", icon: "activity" },
  { id: "insights", label: "Knowledge insights", icon: "insight" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function taskTypeLabel(taskType: WorkspaceAnswer["taskType"]) {
  switch (taskType) {
    case "qa":
      return "Q&A";
    case "summary":
      return "Summary";
    case "analysis":
      return "Analysis";
    case "compare":
      return "Comparison";
    case "recommend":
      return "Recommendation";
  }
}

type VerificationState = "verified" | "review" | "pending";

function verificationState(answer: WorkspaceAnswer): VerificationState {
  if (!answer.runId) return "pending";
  if (
    answer.insufficientEvidence ||
    answer.evidence.length === 0 ||
    answer.claims.some((claim) => claim.supportStatus === "unsupported" || claim.supportStatus === "conflict")
  ) {
    return "review";
  }
  return "verified";
}

function verificationLabel(state: VerificationState) {
  switch (state) {
    case "verified":
      return "Verified against sources";
    case "review":
      return "Review evidence coverage";
    case "pending":
      return "Waiting for evidence";
  }
}

function statusLabel(status: WorkspaceDocument["status"]) {
  switch (status) {
    case "ready":
      return "Ready";
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "uploaded":
      return "Awaiting processing";
    case "failed":
      return "Needs attention";
    case "deleting":
      return "Deleting";
  }
}

function statusClass(status: WorkspaceDocument["status"]) {
  switch (status) {
    case "ready":
      return "status-ready";
    case "uploading":
      return "status-processing";
    case "processing":
      return "status-processing";
    case "uploaded":
      return "status-uploaded";
    case "failed":
      return "status-failed";
    case "deleting":
      return "status-failed";
  }
}

function supportLabel(status: ClaimSupportStatus) {
  switch (status) {
    case "full":
      return "Fully supported";
    case "partial":
      return "Partially supported";
    case "unsupported":
      return "Unsupported";
    case "conflict":
      return "Conflicting evidence";
  }
}

function supportClass(status: ClaimSupportStatus) {
  switch (status) {
    case "full":
      return "support-full";
    case "partial":
      return "support-partial";
    case "unsupported":
      return "support-unsupported";
    case "conflict":
      return "support-conflict";
  }
}

function qaRunStatusLabel(status: WorkspaceQaRun["status"]) {
  switch (status) {
    case "completed":
      return "Completed";
    case "insufficient_evidence":
      return "Insufficient evidence";
    case "failed":
      return "Failed";
  }
}

function insightIcon(type: WorkspaceInsight["type"]): Phase5IconName {
  switch (type) {
    case "frequent":
      return "activity";
    case "gap":
      return "target";
    case "low-confidence":
      return "warning";
    case "unanswered":
      return "clock";
  }
}

function MetricBar({ score, tone = "blue" }: { score: number; tone?: "blue" | "green" | "amber" }) {
  return (
    <div className="metric-bar" aria-hidden="true">
      <span className={cx("metric-bar-fill", `metric-bar-${tone}`)} style={{ width: `${score}%` }} />
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="score-ring" aria-label={`回答置信度 ${score} 分`} role="img">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="score-ring-track" cx="50" cy="50" r={radius} />
        <circle
          className="score-ring-progress"
          cx="50"
          cy="50"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset }}
        />
      </svg>
      <span className="score-ring-value">{score}</span>
      <span className="score-ring-unit">/100</span>
    </div>
  );
}

function FileTypeMark({ type }: { type: WorkspaceDocument["type"] }) {
  return <span className={cx("file-type-mark", `file-type-${type.toLowerCase()}`)}>{type}</span>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" }) {
  return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

function IconButton({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: Phase5IconName;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button className={cx("icon-button", className)} type="button" aria-label={label} onClick={onClick}>
      <Phase5Icon name={icon} />
    </button>
  );
}

function SectionHeading({
  eyebrow,
  title,
  titleId,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId}>{title}</h2>
        {detail ? <p className="section-detail">{detail}</p> : null}
      </div>
      {action ? <div className="section-heading-action">{action}</div> : null}
    </div>
  );
}

export function Phase5Workspace({
  data,
  onUpload,
  onQuerySubmit,
  connectionMode = "demo",
  connectionMessage,
  isLoading = false,
}: Phase5WorkspaceProps) {
  const workspace = useMemo(() => mergeWorkspaceData(data), [data]);
  const [answer, setAnswer] = useState<WorkspaceAnswer>(workspace.answer);
  const [query, setQuery] = useState(workspace.answer.query);
  const [selectedClaimId, setSelectedClaimId] = useState(workspace.answer.claims[0]?.id ?? "");
  const [isRunning, setIsRunning] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("workspace");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const queryEditedRef = useRef(false);
  const lastExternalAnswerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.answer) return;

    const incomingKey = `${data.answer.runId}:${data.answer.createdAt}:${data.answer.query}`;
    if (lastExternalAnswerKeyRef.current === incomingKey) return;

    lastExternalAnswerKeyRef.current = incomingKey;
    setAnswer(data.answer);
    setSelectedClaimId(data.answer.claims[0]?.id ?? "");
    if (!queryEditedRef.current) setQuery(data.answer.query);
    queryEditedRef.current = false;
  }, [data?.answer]);

  useEffect(() => {
    if (mobileNavOpen) navigationRef.current?.focus();
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobileNavOpen(false);
      mobileMenuButtonRef.current?.focus();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileNavOpen]);

  const selectedClaim =
    answer.claims.find((claim) => claim.id === selectedClaimId) ?? answer.claims[0];
  const selectedEvidence = selectedClaim
    ? answer.evidence.filter((item) => selectedClaim.evidenceIds.includes(item.id))
    : [];
  const readyDocuments = workspace.documents.filter((document) => document.status === "ready");
  const indexedChunks = workspace.documents.reduce((total, document) => total + document.chunks, 0);

  async function handleQuerySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isRunning) return;

    setIsRunning(true);
    try {
      const result = await onQuerySubmit?.(trimmedQuery);
      if (result) {
        const nextAnswer: WorkspaceAnswer = {
          ...answer,
          ...result,
          query: result.query ?? trimmedQuery,
          limitations: result.limitations ?? [],
          claims: result.claims ?? [],
          evidence: result.evidence ?? [],
          metrics: result.metrics ?? [],
        };
        setAnswer(nextAnswer);
        setQuery(nextAnswer.query);
        setSelectedClaimId(nextAnswer.claims[0]?.id ?? "");
        queryEditedRef.current = false;
      }
    } catch (error) {
      setNoticeTone("warning");
      setUploadMessage(
        error instanceof Error ? error.message : "The QA run could not be completed.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setNoticeTone("success");
    setUploadMessage(`${file.name} is uploading to the private knowledge store…`);
    void Promise.resolve(onUpload?.(file))
      .then(() => {
        setUploadMessage(
          onUpload
            ? `${file.name} uploaded and queued for knowledge processing.`
            : `${file.name} selected in demo mode. Connect Supabase to upload it.`,
        );
      })
      .catch((error: unknown) => {
        setNoticeTone("warning");
        setUploadMessage(
          error instanceof Error
            ? error.message
            : `${file.name} could not be queued. Check the upload connection.`,
        );
      });
    event.target.value = "";
  }

  function handleNavClick(id: string) {
    setActiveSection(id);
    setMobileNavOpen(false);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
  }

  function showNotice(message: string, tone: "success" | "warning" = "success") {
    setNoticeTone(tone);
    setUploadMessage(message);
  }

  return (
    <div className="novera-app-shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      <aside
        id="app-navigation"
        ref={navigationRef}
        className={cx("app-sidebar", mobileNavOpen && "app-sidebar-open")}
        aria-label="Primary navigation"
        tabIndex={-1}
      >
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true"><span>N</span></div>
          <div>
            <p className="brand-name">Novera AI</p>
            <p className="brand-caption">Knowledge intelligence</p>
          </div>
          <IconButton label="Close navigation" icon="close" className="sidebar-close" onClick={() => setMobileNavOpen(false)} />
        </div>

        <div className="workspace-switcher">
          <div className="workspace-switcher-top"><span className="workspace-avatar">{workspace.knowledgeBaseName.slice(0, 2).toUpperCase()}</span><span>{workspace.knowledgeBaseName}</span><Phase5Icon name="chevron-down" /></div>
          <p>Enterprise workspace</p>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace sections">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button className={cx("nav-item", item.id === activeSection && "nav-item-active")} key={item.id} type="button" onClick={() => handleNavClick(item.id)}>
              <Phase5Icon name={item.icon} /><span>{item.label}</span>
              {item.id === "insights" ? <span className="nav-count">{workspace.insights.length}</span> : null}
            </button>
          ))}
          <p className="nav-label nav-label-spaced">Configure</p>
          <button className="nav-item" type="button" onClick={() => showNotice("Workspace settings are outside the Phase 5 MVP scope.")}>
            <Phase5Icon name="settings" /><span>Workspace settings</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-health-card">
            <div className="health-card-top"><span className="health-pulse" /><span>Knowledge base health</span><span className="health-score">{workspace.healthScore}</span></div>
            <div className="health-track"><span style={{ width: `${workspace.healthScore}%` }} /></div>
            <p>{connectionMode === "live" ? "Live evidence coverage and QA signals." : connectionMode === "disconnected" && data ? "Last synced live health snapshot (stale)." : "Demo health until Supabase is connected."}</p>
          </div>
          <div className="sidebar-user"><div className="user-avatar">YL</div><div><p>Yuki Lin</p><span>Product team</span></div><Phase5Icon name="more" /></div>
        </div>
      </aside>

      {mobileNavOpen ? <button className="sidebar-overlay" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="app-main-column">
        <header className="topbar">
          <button ref={mobileMenuButtonRef} className="mobile-menu-button" type="button" aria-label="Open navigation" aria-controls="app-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Phase5Icon name="menu" /></button>
          <div className="topbar-breadcrumb"><span>Novera AI</span><Phase5Icon name="chevron-right" /><strong>Knowledge workspace</strong></div>
          <div className="topbar-actions"><span className={cx("live-indicator", `live-indicator-${connectionMode}`)}><span />{isLoading ? "Connecting knowledge base" : connectionMode === "live" ? "Live knowledge base" : connectionMode === "disconnected" ? data ? "Live snapshot · stale" : "Demo fallback · disconnected" : "Demo knowledge base"}</span><IconButton label="Search workspace" icon="search" onClick={() => showNotice("Workspace search is not included in this MVP. Use the Task Understanding Layer below.")} /><IconButton label="Notifications" icon="activity" onClick={() => showNotice("Notifications are not included in this MVP.")} /></div>
        </header>

        <main id="main-content" className="workspace-main">
          <section id="workspace" className="workspace-hero" aria-labelledby="workspace-title">
            <div>
              <p className="eyebrow eyebrow-accent"><span className="eyebrow-dot" />Enterprise knowledge intelligence</p>
              <h1 id="workspace-title">Make every answer traceable.</h1>
              <p className="hero-description">Ask a business question and inspect how Novera moves from retrieved knowledge to a verified answer.</p>
            </div>
            <div className="hero-actions">
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.md,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} />
              <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}><Phase5Icon name="upload" />Add knowledge</button>
              <button className="button button-primary" type="button" onClick={() => handleNavClick("qa-composer")}><Phase5Icon name="spark" />Run a QA check</button>
            </div>
          </section>

          {connectionMessage && connectionMode !== "live" ? <div className={cx("connection-banner", connectionMode === "disconnected" && "connection-banner-warning")} role="status"><Phase5Icon name={connectionMode === "disconnected" ? "warning" : "activity"} /><span>{connectionMessage}</span></div> : null}

          {uploadMessage ? <div className={cx("toast-message", noticeTone === "warning" && "toast-message-warning")} role="status"><Phase5Icon name={noticeTone === "warning" ? "warning" : "circle-check"} />{uploadMessage}<button type="button" onClick={() => setUploadMessage(null)} aria-label="Dismiss message"><Phase5Icon name="close" /></button></div> : null}

          <section className="summary-grid" aria-label="Knowledge base summary">
            <SummaryCard label="Knowledge health" value={`${workspace.healthScore}%`} caption="Evidence-ready coverage" icon="target" tone="blue" trend="+6 pts" />
            <SummaryCard label="Ready documents" value={formatCount(readyDocuments.length)} caption={`of ${formatCount(workspace.documents.length)} in workspace`} icon="file-text" tone="green" />
            <SummaryCard label="Indexed chunks" value={formatCount(indexedChunks)} caption="Searchable knowledge units" icon="layers" tone="violet" />
            <SummaryCard label="Recent QA runs" value={formatCount(workspace.qaRuns.length)} caption={workspace.qaRuns[0] ? `Last run ${workspace.qaRuns[0].createdAt}` : "No runs yet"} icon="activity" tone="amber" trend={connectionMode === "live" ? "Live" : "Demo"} />
          </section>

          <section id="qa-composer" className="query-composer-section" aria-labelledby="query-heading">
            <div className="composer-heading"><div><p className="eyebrow">Task understanding layer</p><h2 id="query-heading">What do you need to understand?</h2></div><Badge tone={connectionMode === "live" ? "green" : connectionMode === "disconnected" ? "amber" : "blue"}><span className="status-dot status-dot-blue" />{isLoading ? "Connecting…" : connectionMode === "live" ? "Live knowledge connected" : connectionMode === "disconnected" ? data ? "Stale live snapshot" : "Demo fallback" : "Demo workspace"}</Badge></div>
            <form className="query-form" onSubmit={handleQuerySubmit}>
              <label className="visually-hidden" htmlFor="knowledge-question">Ask a question about your knowledge base</label>
              <div className="query-input-wrap"><Phase5Icon name="spark" /><input id="knowledge-question" value={query} onChange={(event) => { queryEditedRef.current = true; setQuery(event.target.value); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask about product, customers, or operations..." /><kbd>⌘ ↵</kbd></div>
              <button className="button button-primary query-submit" type="submit" disabled={isRunning || !query.trim()}>{isRunning ? <><span className="button-spinner" />Analyzing</> : <><span>Analyze knowledge</span><Phase5Icon name="arrow-up-right" /></>}</button>
            </form>
            <div className="query-suggestions" aria-label="Example questions"><span>Try an analysis:</span><button type="button" onClick={() => setQuery("为什么最近用户流失增加？")}>Why is churn increasing?</button><button type="button" onClick={() => setQuery("Summarize the onboarding friction signals")}>Summarize onboarding friction</button><button type="button" onClick={() => setQuery("What changed in the activation flow?")}>Compare activation changes</button></div>
          </section>

          <div className="workspace-grid">
            <div className="workspace-primary">
              <AnswerExperience answer={answer} selectedClaim={selectedClaim} onSelectClaim={setSelectedClaimId} onNotice={showNotice} />
              <QualityMetrics metrics={answer.metrics} onNotice={showNotice} />
              <SourceDocuments evidence={answer.evidence} documents={workspace.documents} onNotice={showNotice} />
            </div>
            <EvidenceExplorer claim={selectedClaim} evidence={selectedEvidence} answer={answer} onNotice={showNotice} />
          </div>

          <section id="documents" className="lower-grid">
            <DocumentsPanel documents={workspace.documents} onAdd={() => fileInputRef.current?.click()} onNotice={showNotice} />
            <RecentRunsPanel runs={workspace.qaRuns} onSelect={(run) => { queryEditedRef.current = true; setQuery(run.query); showNotice("Question loaded from run history. Run a new QA check to generate a fresh evidence trace."); handleNavClick("qa-composer"); }} />
          </section>

          <section id="insights" className="insights-section" aria-labelledby="insights-heading">
            <SectionHeading titleId="insights-heading" eyebrow="Knowledge memory loop · observation only" title="Knowledge insights" detail="Signals captured from usage. Nothing is auto-learned without review." action={<button className="text-button" type="button" onClick={() => showNotice("Knowledge Insight Log export is not included in this MVP.")}>Insight log status <Phase5Icon name="arrow-up-right" /></button>} />
            <div className="insight-grid">{workspace.insights.length ? workspace.insights.map((insight) => <InsightCard key={insight.id} insight={insight} onNotice={showNotice} />) : <div className="empty-state">No insight signals have been recorded yet.</div>}</div>
          </section>

          <footer className="workspace-footer"><span><span className="footer-dot" />Evidence layer active</span><span>Last indexed {workspace.documents[0]?.updatedAt ?? "recently"}</span><span>{connectionMode === "live" ? "Provider adapter · live workspace" : connectionMode === "disconnected" && data ? "Provider adapter · stale live snapshot" : "Provider adapter · demo safe"}</span></footer>
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, caption, icon, tone, trend }: { label: string; value: string; caption: string; icon: Phase5IconName; tone: "blue" | "green" | "violet" | "amber"; trend?: string }) {
  return <article className="summary-card"><div className={cx("summary-icon", `summary-icon-${tone}`)}><Phase5Icon name={icon} /></div><div className="summary-card-copy"><p>{label}</p><strong>{value}</strong><span>{caption}</span></div>{trend ? <Badge tone={tone === "amber" ? "amber" : "green"}>{trend}</Badge> : null}</article>;
}

function AnswerExperience({
  answer,
  selectedClaim,
  onSelectClaim,
  onNotice,
}: {
  answer: WorkspaceAnswer;
  selectedClaim?: WorkspaceClaim;
  onSelectClaim: (claimId: string) => void;
  onNotice: (message: string, tone?: "success" | "warning") => void;
}) {
  const state = verificationState(answer);
  const verificationIcon = state === "verified" ? "circle-check" : state === "review" ? "warning" : "clock";

  return (
    <section className="answer-panel panel" aria-labelledby="answer-heading">
      <div className="answer-panel-header"><div><div className="run-meta"><span className="run-live-dot" />{answer.runId ? <>QA run {answer.runId} <span>·</span> {answer.createdAt}</> : "Awaiting the first QA run"}</div><h2 id="answer-heading">Evidence-backed answer</h2></div><div className="answer-header-actions"><Badge tone="blue">{taskTypeLabel(answer.taskType)}</Badge><IconButton label="More answer actions" icon="more" onClick={() => onNotice("Answer export and sharing are not included in this MVP.")} /></div></div>
      <div className="question-context"><span className="question-context-label">Question</span><p>{answer.query || "Ask a business question above to begin."}</p></div>
      <div className="answer-lead"><div className="answer-copy"><p className="eyebrow eyebrow-accent">AI answer <span className={cx("verified-label", state === "pending" && "verified-label-muted", state === "review" && "verified-label-review")}><Phase5Icon name={verificationIcon} />{verificationLabel(state)}</span></p><p className="answer-text">{answer.answer}</p>{answer.insufficientEvidence ? <div className="insufficiency-note" role="status"><Phase5Icon name="warning" /><div><strong>Insufficient evidence</strong><p>The current knowledge base does not fully support this answer. Review unsupported claims and limitations before acting.</p></div></div> : null}{answer.limitations.length ? <div className="limitation-note"><Phase5Icon name="warning" /><div><strong>Known limitation{answer.limitations.length === 1 ? "" : "s"}</strong><ul>{answer.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div></div> : null}</div><div className="confidence-block"><ScoreRing score={answer.confidence} /><span>Confidence</span><small>{state === "verified" ? "Based on verified evidence coverage" : state === "review" ? "Reduced by evidence gaps" : "Available after verification"}</small></div></div>
      <div className="claims-block"><div className="subsection-heading"><div><p className="eyebrow">Claim layer</p><h3>{answer.claims.length} traceable claims</h3></div><span className="subsection-hint">Select a claim to explore its evidence</span></div><div className="claim-list">{answer.claims.length ? answer.claims.map((claim, index) => <ClaimCard key={claim.id} claim={claim} index={index} selected={claim.id === selectedClaim?.id} onSelect={() => onSelectClaim(claim.id)} />) : <div className="empty-state">Claims will appear here after the Evidence Layer verifies a QA run.</div>}</div></div>
    </section>
  );
}

function ClaimCard({ claim, index, selected, onSelect }: { claim: WorkspaceClaim; index: number; selected: boolean; onSelect: () => void }) {
  return <button className={cx("claim-card", selected && "claim-card-selected")} type="button" onClick={onSelect} aria-pressed={selected} aria-controls="selected-evidence"><span className="claim-index">0{index + 1}</span><span className="claim-card-copy"><span className="claim-type-row"><span className="claim-type">{claim.type}</span><span className={cx("support-status", supportClass(claim.supportStatus))}><span className="status-dot" />{supportLabel(claim.supportStatus)}</span></span><strong>{claim.text}</strong><span className="claim-evidence-count"><Phase5Icon name="layers" />{claim.evidenceIds.length} evidence source{claim.evidenceIds.length === 1 ? "" : "s"}</span></span><Phase5Icon name="chevron-right" className="claim-chevron" /></button>;
}

function EvidenceExplorer({
  claim,
  evidence,
  answer,
  onNotice,
}: {
  claim?: WorkspaceClaim;
  evidence: WorkspaceEvidence[];
  answer: WorkspaceAnswer;
  onNotice: (message: string, tone?: "success" | "warning") => void;
}) {
  const state: VerificationState = !claim
    ? "pending"
    : answer.insufficientEvidence || evidence.length === 0 || claim.supportStatus === "unsupported" || claim.supportStatus === "conflict"
      ? "review"
      : "verified";
  const stateLabel = state === "verified" ? "Verified" : state === "review" ? "Review needed" : "Awaiting evidence";
  const stateIcon = state === "verified" ? "circle-check" : state === "review" ? "warning" : "clock";

  return (
    <aside className="evidence-panel panel" aria-labelledby="evidence-heading">
      <div className="evidence-panel-top"><div><p className="eyebrow eyebrow-accent">Evidence explorer</p><h2 id="evidence-heading">Trace the answer</h2></div><Badge tone={state === "verified" ? "green" : state === "review" ? "amber" : "neutral"}><Phase5Icon name={stateIcon} />{stateLabel}</Badge></div>
      <div className="evidence-chain" aria-label="Answer to source traceability"><ChainNode label="Answer" value="1 structured answer" icon="spark" active /><span className="chain-line" /><ChainNode label="Claim" value={claim ? `Claim 0${(answer.claims.findIndex((item) => item.id === claim.id) + 1)}` : "Select a claim"} icon="target" active={Boolean(claim)} /><span className="chain-line" /><ChainNode label="Evidence" value={`${evidence.length} attached`} icon="layers" active={evidence.length > 0} /><span className="chain-line" /><ChainNode label="Source" value={evidence[0]?.citationLabel ?? "—"} icon="file-text" active={evidence.length > 0} /></div>
      {claim ? <div className="explorer-claim"><div className="explorer-claim-heading"><span className="claim-index">0{answer.claims.findIndex((item) => item.id === claim.id) + 1}</span><div><p className="eyebrow">Selected claim</p><h3>{claim.text}</h3></div></div><span className={cx("support-status explorer-support", supportClass(claim.supportStatus))}><span className="status-dot" />{supportLabel(claim.supportStatus)}</span></div> : <div className="explorer-empty"><Phase5Icon name="target" /><p>Select a claim to inspect its sources.</p></div>}
      <div id="selected-evidence" className="explorer-evidence-list" aria-live="polite"><div className="subsection-heading"><h3>Evidence from this QA run</h3><span>{evidence.length} items</span></div>{evidence.length ? evidence.map((item) => <EvidenceCard key={item.id} evidence={item} onInspect={() => onNotice(`${item.documentName} · ${item.locator}`)} />) : <div className="empty-state">No evidence was attached to this claim.</div>}</div>
      <div className={cx("explorer-footer", state === "review" && "explorer-footer-review")}><Phase5Icon name={stateIcon} /><p>{state === "verified" ? "Every quote is checked against persisted chunk text and a READY source document." : state === "review" ? "This claim needs review because its evidence is incomplete, unsupported, or conflicting." : "Select a claim to inspect its evidence and source locator."}</p></div>
    </aside>
  );
}

function ChainNode({ label, value, icon, active }: { label: string; value: string; icon: Phase5IconName; active: boolean }) {
  return <div className={cx("chain-node", active && "chain-node-active")}><span className="chain-node-icon"><Phase5Icon name={icon} /></span><span className="chain-node-label">{label}</span><strong>{value}</strong></div>;
}

function EvidenceCard({ evidence, compact = false, onInspect }: { evidence: WorkspaceEvidence; compact?: boolean; onInspect: () => void }) {
  return <article className={cx("evidence-card", compact && "evidence-card-compact")}><div className="evidence-card-meta"><Badge tone="blue">{evidence.citationLabel}</Badge><span>{evidence.locator}</span><span className="evidence-score">{evidence.supportScore}% support</span></div><blockquote>“{evidence.quote}”</blockquote><button className="evidence-card-source" type="button" onClick={onInspect} aria-label={`Inspect ${evidence.documentName} at ${evidence.locator}`}><span className="source-doc-icon"><Phase5Icon name="file-text" /></span><span className="evidence-card-source-copy"><strong>{evidence.documentName}</strong>{evidence.section ? <span>{evidence.section}</span> : null}</span><Phase5Icon name="arrow-up-right" /></button></article>;
}

function QualityMetrics({ metrics, onNotice }: { metrics: WorkspaceMetric[]; onNotice: (message: string) => void }) {
  return <section className="metrics-panel panel" aria-labelledby="metrics-heading"><SectionHeading titleId="metrics-heading" eyebrow="Quality evaluation" title="How reliable is this answer?" detail="Deterministic checks explain what the model had to work with." action={<button className="text-button" type="button" onClick={() => onNotice("Metric explanations are shown directly beneath each quality score.")}>Evaluation guide <Phase5Icon name="chevron-right" /></button>} /><div className="metrics-grid">{metrics.length ? metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />) : <div className="empty-state">Quality metrics will appear after a QA run completes.</div>}</div></section>;
}

function MetricCard({ metric }: { metric: WorkspaceMetric }) {
  const tone = metric.score >= 88 ? "green" : metric.score >= 75 ? "blue" : "amber";
  return <article className="metric-card"><div className="metric-card-top"><span>{metric.label}</span><strong>{metric.score}<small>/100</small></strong></div><MetricBar score={metric.score} tone={tone} /><p>{metric.explanation}</p></article>;
}

function SourceDocuments({ evidence, documents, onNotice }: { evidence: WorkspaceEvidence[]; documents: WorkspaceDocument[]; onNotice: (message: string) => void }) {
  const sourceIds = Array.from(new Set(evidence.map((item) => item.documentId)));
  const sources = sourceIds.map((id) => {
    const document = documents.find((item) => item.id === id);
    const snapshot = evidence.find((item) => item.documentId === id);
    return {
      id,
      document,
      name: document?.name ?? snapshot?.documentName ?? "Source document snapshot",
      locator: snapshot?.locator ?? "Source location unavailable",
      evidenceCount: evidence.filter((item) => item.documentId === id).length,
    };
  });

  return <section className="sources-panel panel" aria-labelledby="sources-heading"><SectionHeading titleId="sources-heading" eyebrow="Source documents" title="Knowledge behind the answer" detail={`${sources.length} documents contributed evidence to this QA run.`} action={sources.length ? <button className="text-button" type="button" onClick={() => onNotice(`${sources.length} source documents are listed with their persisted locators below.`)}>Source trace guide <Phase5Icon name="arrow-up-right" /></button> : undefined} /><div className="source-list">{sources.length ? sources.map((source) => <button className="source-row" type="button" key={source.id} onClick={() => onNotice(`${source.name} · ${source.locator}`)} aria-label={`Inspect ${source.name} at ${source.locator}`}>{source.document ? <FileTypeMark type={source.document.type} /> : <span className="source-doc-icon"><Phase5Icon name="file-text" /></span>}<span className="source-row-copy"><strong>{source.name}</strong><span>{source.document ? `${source.document.chunks} indexed chunks · updated ${source.document.updatedAt}` : `Persisted source snapshot · ${source.locator}`}</span></span><span className="source-row-evidence">{source.evidenceCount} evidence</span><Phase5Icon name="chevron-right" /></button>) : <div className="empty-state">Source documents will appear when evidence is attached to a QA run.</div>}</div></section>;
}

function DocumentsPanel({ documents, onAdd, onNotice }: { documents: WorkspaceDocument[]; onAdd: () => void; onNotice: (message: string) => void }) {
  return <section className="documents-panel panel"><SectionHeading eyebrow="Knowledge workspace" title="Documents" detail={`${documents.length} sources · ${documents.filter((item) => item.status === "ready").length} evidence-ready`} action={<button className="button button-small button-secondary" type="button" onClick={onAdd}><Phase5Icon name="plus" />Add document</button>} /><div className="document-list">{documents.length ? documents.map((document) => <DocumentRow key={document.id} document={document} onNotice={onNotice} />) : <div className="empty-state">Upload a PDF, Markdown, or TXT file to begin building READY knowledge.</div>}</div></section>;
}

function DocumentRow({ document, onNotice }: { document: WorkspaceDocument; onNotice: (message: string) => void }) {
  const progress = document.progress ?? 0;
  return <article className="document-row"><FileTypeMark type={document.type} /><div className="document-row-main"><div className="document-row-title"><strong>{document.name}</strong><span className={cx("document-status", statusClass(document.status))}><span className="status-dot" />{statusLabel(document.status)}</span></div><div className="document-row-meta"><span>{document.size}</span><span>·</span><span>{document.status === "ready" ? `${document.chunks} chunks` : document.status === "processing" ? `${progress}% processed` : "Not indexed"}</span><span>·</span><span>Updated {document.updatedAt}</span></div>{document.status === "processing" ? <div className="processing-track" role="progressbar" aria-label={`Processing ${document.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div> : null}</div><IconButton label={`Document details for ${document.name}`} icon="more" onClick={() => onNotice(`${document.name} is ${statusLabel(document.status).toLowerCase()} · ${document.chunks} indexed chunks.`)} /></article>;
}

function RecentRunsPanel({ runs, onSelect }: { runs: WorkspaceQaRun[]; onSelect: (run: WorkspaceQaRun) => void }) {
  return <section id="qa-runs" className="runs-panel panel"><SectionHeading eyebrow="Run history" title="Recent QA runs" detail="Reuse a previous question to generate a fresh, fully traceable run." /><div className="run-list">{runs.length ? runs.map((run) => <button className="run-row" type="button" key={run.id} onClick={() => onSelect(run)} aria-label={`Reuse question from ${qaRunStatusLabel(run.status)} run: ${run.query}`}><span className="run-status-icon"><Phase5Icon name={run.status === "completed" ? "circle-check" : run.status === "insufficient_evidence" ? "warning" : "x"} /><span className="visually-hidden">{qaRunStatusLabel(run.status)}</span></span><span className="run-row-main"><strong>{run.query}</strong><span><span className="run-task-tag">{taskTypeLabel(run.taskType)}</span><span>·</span>{run.createdAt}<span>·</span>{run.sourceCount} sources</span></span><span className={cx("run-confidence", run.confidence < 70 && "run-confidence-low")}>{run.confidence}<small>%</small></span><Phase5Icon name="arrow-up-right" className="run-chevron" /></button>) : <div className="empty-state">No QA runs have been recorded yet.</div>}</div></section>;
}

function InsightCard({ insight, onNotice }: { insight: WorkspaceInsight; onNotice: (message: string, tone?: "success" | "warning") => void }) {
  const tone = insight.type === "gap" || insight.type === "unanswered" ? "amber" : insight.type === "low-confidence" ? "red" : "blue";
  return <article className={cx("insight-card", `insight-card-${tone}`)}><div className="insight-card-top"><span className="insight-icon"><Phase5Icon name={insightIcon(insight.type)} /></span><span className="insight-label">{insight.label}</span><span className="insight-count">{insight.count}</span></div><h3>{insight.question}</h3><p>{insight.detail}</p><button className="insight-link" type="button" onClick={() => onNotice(`${insight.label}: ${insight.detail}`, insight.type === "gap" || insight.type === "low-confidence" || insight.type === "unanswered" ? "warning" : "success")}>Inspect signal <Phase5Icon name="arrow-up-right" /></button></article>;
}
