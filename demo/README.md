# Novera AI deterministic enterprise demo dataset

This folder contains a portfolio-safe dataset for demonstrating Novera AI as an **Enterprise Knowledge Intelligence System**, not a generic document chat application.

The fictional tenant is **Asteria Workcloud**, and its fictional product is **RelayOS**. Every company, person, customer, competitor, metric, and event in this folder is invented. No production data, customer identifiers, credentials, or private URLs are included.

## What is included

| Path | Role |
|---|---|
| `company-background.md` | Human-readable fictional company and demo storyline |
| `corpus/01-q2-retention-review.md` | Retention and activation evidence |
| `corpus/02-onboarding-experiment-brief.md` | Controlled experiment and recommendation evidence |
| `corpus/03-product-release-notes.md` | Product-change timeline and support signal |
| `corpus/04-support-escalation-sop.md` | Operational SLA and Knowledge Insight policy |
| `corpus/05-competitor-comparison.md` | Bounded fictional competitor comparison |
| `manifest.json` | Stable document IDs, hashes, typical questions, exact evidence, and knowledge-gap expectations |
| `demo-runbook.md` | Short operator flow for a portfolio demonstration |
| `validate-demo.mjs` | Deterministic local integrity check |

## Why this corpus matches the product pipeline

- Every upload source is UTF-8 Markdown and below the current 20 MiB default limit.
- Flat YAML frontmatter is compatible with the current Markdown parser.
- ATX `#` / `##` / `###` headings create stable section paths for structured chunking.
- Important facts are independent paragraphs or list lines, preserving exact source text and one-based line locators for Evidence.
- Cross-document questions require retrieval, synthesis, Claim extraction, Evidence verification, and Source tracing.
- The manifest does not invent database chunk IDs; ingestion creates real document and chunk UUIDs.
- The ARR question is intentionally unsupported so the demo can show conservative refusal and Knowledge Insight logging.

## Validate before a demo

From the repository root:

```bash
node demo/validate-demo.mjs
```

The validator checks JSON structure, UTF-8 decoding, supported upload types, byte size, SHA-256, frontmatter IDs, H1 titles, section paths, exact evidence quotes, and source line locators. If a corpus file changes intentionally, update its manifest size, hash, quote, and locator before considering the dataset ready.

See `demo-runbook.md` for the upload and question sequence.
