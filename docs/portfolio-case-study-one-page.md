# Novera AI — Evidence-first Enterprise RAG MVP

## Problem

Enterprise knowledge tools often make fluent answers look more trustworthy than the evidence allows. The product question was narrower: can a team upload a small source set, retrieve relevant passages, generate a structured answer, verify every material claim against persisted source text, and explicitly refuse when evidence is insufficient?

## Product scope

Novera AI supports PDF, Markdown, TXT, and DOCX ingestion; asynchronous parsing, chunking, real embeddings, and pgvector retrieval; Task Understanding; structured generation; Claim–Evidence verification; source locator metadata; quality metrics; knowledge-gap logging; and durable QA history. DOCX has parser unit coverage, while end-to-end DOCX upload was not verified in this review. Evidence previews show verified quotes with section/page/line metadata; an embedded source viewer and precise jump-to-source interaction are not implemented. Payment, multi-tenancy, complex RBAC/SSO, autonomous repair, multi-Agent planning, and enterprise scale are intentionally out of scope.

## Key decisions

1. **Evidence is a data relationship.** Every accepted quote must belong to the current retrieval context, a READY document, the matching persisted chunk, and an exact source substring. Database RPCs revalidate the same boundary transactionally.
2. **Refusal happens after verification.** If no proposed Evidence survives, unverified model prose is replaced with a deterministic insufficient-evidence response. The run is persisted for audit, but the unverified answer is not returned or stored as the assistant answer.
3. **Demo is never production proof.** The checked-in Asteria Workcloud demo corpus is fictional and validated locally; its fallback Workspace is illustrative, not a working live RAG system.
4. **Retrieval is testable offline.** The versioned retrieval Golden Dataset has five cases. Its deterministic expected-result fixture yields Hit Rate@K, Recall@K, MRR, document recall, and chunk recall of 1.0; these are fixture/evaluator results, not live retrieval measurements. Separately, the demo validator checks five documents, 14 supported questions, 4 knowledge-gap cases, and 36 evidence quotes.

## Architecture

```text
Upload → private Supabase Storage → Parser/Normalizer/Chunker
       → real Embedding → pgvector → READY
Question → Task Understanding → retrieval → bounded context
         → structured answer → Claims → Evidence verification
         → safe answer/refusal → metrics + persistent QA trace
```

## Local verification status — 2026-10-17

In this local review, `npm test` passed with 174 tests across 39 files, `npm run demo:validate` passed with five documents, 14 supported questions, 4 knowledge-gap cases, and 36 evidence quotes, and `npm run eval:retrieval` passed for five deterministic fixture cases. These results do not establish staging or production behavior. Staging smoke, online Supabase/Vercel configuration, protected Preview behavior, and human user testing were not verified in this review. DOCX parsing is implemented and has parser unit coverage; end-to-end DOCX upload was not verified. Evidence previews expose verified quotes and locator metadata; an embedded document viewer is not implemented.

## Outcome and next gate

The MVP distinguishes locally validated fixtures and tests from live deployment verification. No staging smoke, interview evaluation, or user research result is claimed here.
