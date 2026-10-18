# Novera AI portfolio demo runbook

Expected live duration: **3–5 minutes**. Use only the fictional files in `demo/corpus/`.

## 1. Preflight

Complete this section before the timed demonstration:

1. Run `node demo/validate-demo.mjs` and require a passing result. This is the public, local fixture check.
2. For the public repository version, use the fictional corpus and describe the flow as a Demo unless a separately configured environment has been validated.
3. A live Validation run requires a protected Preview, internal staging checks, and the matching internal evaluation records. Those commands and reports are not included in the public repository; do not present the flow as live-validated without that evidence.
4. If a configured environment is available, open the Knowledge Workspace and label it accurately as `实时知识库` or `演示数据模式`.

The internal staging path validates temporary real upload → processing → embedding → retrieval → QA → Evidence → metrics. It does not import this full portfolio corpus. If the local network cannot reach the protected Preview hostname, stop and record the network block rather than presenting the Demo snapshot as live evidence.

## 2. Build READY knowledge

The following live-upload steps require an independently configured protected
Preview or Validation environment, a matching Supabase project, configured
model providers, and the internal validation evidence described above. These
services, credentials, and records are not supplied by the public checkout.
Without that environment, stop after the local fixture check and present the
fictional corpus as a Demo; do not treat this section as a zero-configuration
local workflow.

When those prerequisites are available, upload these five files from the **Add document** action, in manifest order:

1. `demo/corpus/01-q2-retention-review.md`
2. `demo/corpus/02-onboarding-experiment-brief.md`
3. `demo/corpus/03-product-release-notes.md`
4. `demo/corpus/04-support-escalation-sop.md`
5. `demo/corpus/05-competitor-comparison.md`

In a separately configured live environment, the browser flow computes SHA-256, initializes a signed upload, writes to private Storage, completes the upload, and schedules processing. Wait until every document displays **Ready** before running questions. This live upload path is not established by the public local fixture check. Do not upload `manifest.json`, this runbook, or `company-background.md` as knowledge sources.

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
