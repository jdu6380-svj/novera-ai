---
document_id: asteria-support-escalation-sop-2026
company: Asteria Workcloud
product: RelayOS
document_type: support-sop
version: 2.3
effective_date: 2026-07-12
owner: Customer Operations
fictional: true
---

# RelayOS Support Escalation SOP

## Purpose and scope

This fictional SOP explains how Customer Operations triages RelayOS support issues and records enough context for Product and Engineering to act. It applies to trial and paid workspaces. It is not a customer-facing service-level agreement.

## Severity and response targets

### Severity definitions

- **S1 — Critical:** production workflows are unavailable for multiple workspaces, or a confirmed data-integrity risk exists.
- **S2 — High:** a core workflow is blocked for one workspace with no reasonable workaround.
- **S3 — Normal:** a degraded feature or repeatable workaround is available.
- **S4 — Question:** how-to requests, documentation gaps, or cosmetic issues.

### Initial response targets

- S1: acknowledge within 15 minutes, 24 hours a day.
- S2: acknowledge within 1 business hour.
- S3: acknowledge within 4 business hours.
- S4: acknowledge within 1 business day.

The target is an initial human acknowledgement, not a promise to resolve the issue within that interval. The on-call lead may reclassify severity when impact changes.

## Required evidence capture

Every S1–S3 escalation must include the workspace ID, affected workflow, user impact, UTC timestamps, reproduction steps, last known good behavior, and relevant screenshots or request IDs. Redact access tokens, customer secrets, and personal data before adding an attachment.

The escalation owner must link the related release version and identify whether the issue is reproducible in a sandbox workspace. If the issue cannot be reproduced, record the exact uncertainty instead of filling the field with an assumption.

## Knowledge insight logging

Create a Knowledge Insight Log entry when a user asks a recurring question, when the knowledge base cannot support an answer, or when a QA answer receives a low-confidence score. Record the question, affected workflow, source documents consulted, confidence or missing evidence, and a proposed documentation owner.

Insight logging is evidence capture only. It does not automatically edit documents, change embeddings, or feed an unreviewed answer back into generation.

## Escalation path

Customer Operations owns intake and first response. Product Platform owns confirmed product defects. Growth Product owns onboarding experiments. The on-call lead is the escalation point for S1 incidents and decides whether to open an incident channel.

