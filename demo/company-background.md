---
company: Asteria Workcloud
product: RelayOS
dataset_id: novera-phase6-asteria-demo-v1
fictional: true
status: portfolio-demo
---

# Asteria Workcloud

> **Fictional portfolio dataset.** Asteria Workcloud, RelayOS, every person, customer, competitor, metric, and event in this folder is invented for the Novera AI demonstration. It is not a statement about a real company or product.

## Company snapshot

Asteria Workcloud is a fictional 180-person B2B software company. Its fictional product, **RelayOS**, helps distributed service teams coordinate work, publish repeatable workflows, and connect operational systems. The demo tenant represents a small enterprise knowledge base used by a product and customer-success team.

The dataset is intentionally small but cross-document. A retention review describes the problem, an onboarding experiment tests a response, release notes explain a product change, a support procedure defines operational follow-through, and a competitor brief supplies a comparison context.

## Demo storyline

The central question is:

> Why did new-user activation and early retention decline, and what should the team do next?

The answer should not be inferred from one document alone. A useful response connects the retention signal to the onboarding friction, checks the product-release timeline, and distinguishes measured evidence from recommendations. The manifest records the expected evidence chain for those questions.

## Evidence conventions

Every uploaded source has a stable document ID in `manifest.json`. The IDs are fixture identifiers, not database UUIDs; ingestion creates the real document and chunk UUIDs. Evidence quotes in the manifest are copied byte-for-byte from the source files so a demo run can verify them against persisted chunk text and source locators.

The corpus is designed for deterministic replay. It contains no customer personal data, secrets, credentials, private URLs, or production identifiers. The intentionally unsupported ARR question in the manifest demonstrates how Novera AI should surface a knowledge gap instead of inventing a number.
