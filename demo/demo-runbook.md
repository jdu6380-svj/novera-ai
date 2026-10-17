# Novera AI portfolio demo runbook

Expected live duration: **3–5 minutes**. Use only the fictional files in `demo/corpus/`.

## 1. Preflight

Complete this section before the timed demonstration:

1. Run `node demo/validate-demo.mjs` and require a passing result.
2. Open the protected Validation candidate and confirm `/api/v1/health` reports `status: "ready"`. The anonymous health response intentionally omits provider and dependency details.
3. Require `PHASE6_STAGING_SMOKE_PASSED` and the interview evaluation report from the same release candidate before presenting the flow as live-validated. Otherwise label the run as a Demo or blocked Validation check.
4. Open the Knowledge Workspace. Confirm it says `实时知识库`; stop if it says `演示数据模式`.

For a configured staging environment, `npm run smoke:phase6:staging` independently validates a temporary real upload → processing → embedding → retrieval → QA → Evidence → metrics path. It does not import this full portfolio corpus. If the local network cannot reach the protected Preview hostname, stop and record the network block rather than presenting the Demo snapshot as live evidence.

## 2. Build READY knowledge

Before the timed demonstration, upload these five files from the **Add document** action, in manifest order:

1. `demo/corpus/01-q2-retention-review.md`
2. `demo/corpus/02-onboarding-experiment-brief.md`
3. `demo/corpus/03-product-release-notes.md`
4. `demo/corpus/04-support-escalation-sop.md`
5. `demo/corpus/05-competitor-comparison.md`

The browser flow computes SHA-256, initializes a signed upload, writes to private Storage, completes the upload, and schedules processing. Wait until every document displays **Ready** before running questions. Do not upload `manifest.json`, this runbook, or `company-background.md` as knowledge sources.

## 3. Timed demo: supported analysis (2–3 minutes)

Run the manifest question `analysis-early-retention-decline`:

> Analyze why early retention declined and separate strong evidence from directional signals.

Show the result in this order:

1. Task Understanding Layer classification (`analysis`).
2. Structured AI Answer and limitations.
3. Confidence Score plus Retrieval Score, Evidence Coverage, and Knowledge Match explanations.
4. Each Claim and its support status.
5. Claim → verified Evidence quote → Source Document → displayed section/page/line metadata in Evidence Explorer.

The key product moment is not the prose alone. It is the ability to distinguish the measured activation/churn signal, the plausible v3.8 mechanism, the controlled experiment result, and the explicit causal limitation.

## 4. Timed demo: credible refusal (1 minute)

Run `gap-july-2026-arr`:

> What was Asteria Workcloud's ARR in July 2026?

Show that no value is invented, the result is `insufficient_evidence`, Confidence is below 50, and a Knowledge Insight gap is recorded.

## 5. Close (30 seconds)

Contrast the supported cross-document analysis with the refusal: the model may propose an answer, but Novera AI only keeps and presents output that survives the Evidence boundary. Point to the saved retrieval, citation, refusal, latency, and cost report.

## Optional follow-up questions

Use the exact prompts in `manifest.json`:

- `summary-q2-retention` — one-document summarization with limits.
- `compare-permissions-integrations` — structured comparison of three fictional products.
- `recommend-trial-activation` — recommendation grounded in measured guardrails.
- `qa-support-s1-response` — precise SOP retrieval.
- `qa-knowledge-insight-policy` — explains that logging does not auto-train the system.

For each run, select at least one Claim and verify that the Evidence quote is present in the expected source and section listed in the manifest. In live Validation, describe this as an Evidence preview; the current action does not open a document viewer or perform precise scroll-to-source navigation.

Use these only when time remains; they are not part of the core 3–5 minute path.
