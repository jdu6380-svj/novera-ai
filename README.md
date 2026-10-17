# Novera AI

Novera AI is an **Enterprise Knowledge Intelligence System**. It turns enterprise documents into a retrievable, analyzable, and verifiable knowledge foundation rather than a generic knowledge-base chat interface.

Phase 1 establishes ingestion and evidence foundations. Phase 2 turns uploaded source files into traceable, vectorized `ready` knowledge. Phase 3 turns user queries into bounded, evidence-ready retrieval context. Phase 4 turns retrieved knowledge into structured, verified, quality-scored answers. Phase 5 presents that trust chain in an evidence-first Knowledge Workspace. Phase 6 packages the system with a deterministic enterprise demo corpus, a staging smoke path, and a portfolio case study. The staging smoke scripts are internal validation materials and are excluded from the first public file set.

## Implemented scope

- Supabase PostgreSQL schema with pgvector
- Answer → Claim → Evidence → Source Document traceability schema
- lightweight Knowledge Insight Log
- shared domain types and explicit document/job state machines
- private Supabase Storage bucket configuration
- signed document upload initialization and completion APIs
- PDF, Markdown, TXT, and DOCX validation
- browser helper for checksum → signed upload → completion
- PDF, Markdown, TXT, and DOCX Parser Layer
- source-preserving Normalizer Layer and structured Chunker Layer
- OpenAI-compatible embedding provider adapter with model/version/dimension/timestamp audit data
- asynchronous processing jobs with failure and retry states
- atomic chunk/vector publication before a document becomes `ready`
- READY-only pgvector retrieval with document/chunk/source locators
- deterministic Task Understanding Layer (`qa`, `summary`, `analysis`, `compare`, `recommend`)
- bounded Context Builder with citation labels, deduplication, source diversity, and token/character budgets
- versioned Golden Dataset and deterministic evaluator; the live retrieval evaluator and staging smoke test are internal validation materials excluded from the first public file set
- 18-case Portfolio Golden Dataset for internal validation, excluded from the first public file set
- structured Answer Generator with strict JSON output and safe insufficient-evidence behavior
- Claim Extraction and exact-quote Evidence Verification Layers
- explained Retrieval Score, Evidence Coverage, Knowledge Match, and Confidence Score
- transactional QA Run persistence for queries, retrieval snapshots, answers, Claims, Evidence, Sources, metrics, and feedback context
- per-run latency, token usage, auditable price assumptions, and estimated cost output
- Task Understanding Layer and Knowledge Insight Log integration
- evidence-first Product Experience Layer with Workspace, Answer Experience, Evidence Explorer, Recent QA Runs, and Knowledge Insights
- live `GET /api/v1/workspace` snapshot API with product-facing data mapping
- connected QA submission and signed document upload actions in the workspace
- evidence-sufficiency-aware verification states that never label unsupported output as verified
- stale-live snapshot handling and bounded upload-processing refresh polling
- responsive/mobile navigation, connection-state labelling, source-locator actions, and baseline accessibility affordances
- deterministic fictional enterprise demo corpus with exact expected Evidence and locator validation
- true staging smoke for signed upload → Storage → processing → READY → retrieval → QA → Evidence → metrics
- portfolio case study, demo runbook, and explicit production-readiness release gate

Phase 6 remains an MVP product surface. Supabase Auth protects live API routes with Bearer access tokens, and each authenticated user receives an owner-bound knowledge workspace. Document, processing, retrieval, QA, and private Storage access are scoped to that workspace. Setting the server-side `PUBLIC_DEMO_MODE=true` enables the preset fictional Demo workspace and blocks live document, processing, retrieval, and QA operations; this is an explicit environment switch, not an automatic `VERCEL_ENV` rule. Multi Agent planning, a standalone analytics Dashboard, and automatic knowledge optimization remain out of scope.

Live Supabase/Vercel configuration is environment-specific and is not established
by this repository. The staging smoke is not reported as passed; see Validation
below for the current local and fixture-only evidence.

This repository does not currently include a `LICENSE` file. Public visibility
does not grant an open-source license or other permission to reuse the code;
please obtain the necessary authorization before reusing it.

## Phase 4: Agent + Evidence Intelligence

The QA pipeline is deliberately structured around the trust chain:

```text
Query
  → Task Understanding Layer
  → Retrieval + bounded context
  → structured Answer
  → Claims
  → verified Evidence
  → Source Document + locator
  → explained quality metrics
  → persistent QA Run + Knowledge Insight observation
```

Evidence is accepted only when it belongs to the current retrieval result, a
READY source document, and the persisted source text. Unsupported output is
downgraded to a deterministic insufficient-evidence answer.

## Phase 5: Product Experience Layer

The home experience is an evidence-first Knowledge Workspace rather than a
generic chat timeline. It includes:

- knowledge health and document/processing state;
- a Task Understanding query composer;
- AI Answer, confidence, Claims, Evidence, Sources, and metric explanations;
- Claim → Evidence → Source exploration with section/page/line locators;
- recent QA Run history; and
- observation-only Knowledge Insight cards for frequent, unanswered,
  low-confidence, and knowledge-gap signals.

The Workspace uses live Supabase data when available and falls back to a
clearly labelled demo snapshot when the environment is disconnected.

## Phase 6: Portfolio Demo & Production Readiness

The checked-in `demo/` corpus describes the fictional company Asteria
Workcloud and includes five Markdown source documents, 14 supported questions,
four intentional knowledge-gap cases, and 36 exact expected Evidence quotes.
Validate its hashes, source text, headings, section paths, and line locators
before a demonstration:

```bash
npm run demo:validate
```

Use `demo/demo-runbook.md` for the upload and Evidence Explorer walkthrough.
The complete deployed-environment release gate is an internal validation path
and is excluded from the first public file set.
The demo corpus and operator walkthrough are in `demo/`; deterministic
retrieval fixture details are in `evals/retrieval/README.md`.

## Stack

- Next.js 16 App Router and TypeScript
- Supabase PostgreSQL, pgvector, and private Storage
- provider adapters for LLM and embedding integrations
- Vitest for domain and application tests

## Local setup

Requirements:

- Node.js 20 or newer
- Docker-compatible runtime for local Supabase

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env.local
```

Start and reset local Supabase so all checked-in migrations run:

```bash
npm run supabase:start
npm run supabase:reset
```

Copy the local Supabase URL, browser-safe anon/publishable key, and server-only
service-role key into `.env.local`. Configure `EMBEDDING_API_KEY` (or the
OpenAI fallback) for embeddings and `DEEPSEEK_API_KEY` when
`LANGUAGE_MODEL_PROVIDER=deepseek`; the provider settings and non-secret
defaults are documented in `.env.example`. The default knowledge-base ID and
private bucket name already match the migrations.

Start the application:

```bash
npm run dev
```

## Document upload flow

```text
Browser computes SHA-256
  → POST /api/v1/documents/init
  → browser uploads directly with the short-lived Storage token
  → POST /api/v1/documents/{id}/complete
  → server verifies object size/type
  → processing job becomes pending
  → Parser → Normalizer → Chunker → Embedding → atomic vector storage
  → document becomes ready
```

The browser helper is `uploadDocument()` in `src/features/documents/client/upload-document.ts`.

Live API routes require a Supabase access token in the `Authorization: Bearer`
header. The private service-role key is only used by server-only infrastructure
modules. Browser uploads use the browser-safe key plus a short-lived signed
upload token; the Storage bucket remains private and is scoped to the owning
workspace.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run demo:validate
npm run eval:retrieval
```

The commands above are the reproducible checks included in the first public file
set. They do not call deployed services.

The following commands are internal validation materials and are not included in
the first public file set: `npm run eval:portfolio`,
`npm run eval:retrieval:live`, and all `npm run smoke:*:staging` commands. They
call configured deployed services and may create or remove test records; use an
isolated staging deployment, never Production, when running them from the full
working repository. Cleanup is best effort and is not a rollback guarantee.

The retrieval API is `POST /api/v1/retrieval/query`. It returns Task
Understanding output, Top-K chunks with similarity/metadata/locator fields, and
bounded `[S1]`-style prompt context. API-backed retrieval evaluation and the
staging retrieval smoke are internal validation materials excluded from the
first public file set.

The readiness API is `GET /api/v1/health`. It returns HTTP `200` only when the
required real-provider configuration, Supabase connection, and default
knowledge base are available.

`npm run eval:retrieval` is an offline evaluator over five checked-in fixture
cases. Its perfect fixture scores validate the evaluator against expected
results; they are not live retrieval performance.

See `docs/user-task-test.md` for the proposed 3–5 person task test.

The full working repository also contains an internal Phase 6 staging smoke that
validates signed upload → private Storage → Parser/Normalizer/Chunker → real
embedding → pgvector → READY → retrieval → QA Run → Claim → Evidence → Source
→ metrics. It is excluded from the first public file set and was not run in this
publication-preparation pass. The current local verification record is:

- `npm test`: **170 tests across 38 files**;
- `npm run typecheck`: passed;
- `npm run lint`: passed; and
- `npm run build`: passed with Next.js 16.2.12.

The Phase 6 staging smoke is currently **skipped**, not passed, because this
environment does not define `QA_SMOKE_URL` and cannot reach the protected
Validation deployment from the current network. The smoke script reports
`PHASE6_STAGING_SMOKE_SKIPPED` until that URL and the matching staging
credentials are available to the runner.

This publication-preparation pass reran `npm test`, `npm run demo:validate`,
`npm run eval:retrieval`, and the public Demo route-boundary test. Typecheck,
lint, build, live retrieval evaluation, and staging smoke were not rerun here;
the recorded results for those checks come from the existing delivery reports.

Public Production boundary regression coverage also verifies that live document,
processing, retrieval, and QA routes return `403 PUBLIC_DEMO_READ_ONLY` before
any Supabase or model access; the preset Demo Workspace remains readable.

Database migrations live in `supabase/migrations`. Run `npm run supabase:lint` after local Supabase is available.

The Knowledge Insight migration exposes a server-role-only `record_knowledge_insight` RPC for
atomic signal aggregation. It records usage-derived knowledge signals without feeding them back
into generation or changing source knowledge.

## Key directories

```text
src/domain/                         Shared domain contracts and state machines
src/features/documents/             Upload application, HTTP, client, and repository code
src/features/knowledge-insights/    Non-learning insight aggregation service and repository
src/features/knowledge-processing/  Parser, normalizer, chunker, job orchestration, and APIs
src/features/retrieval/             Retriever, Task Understanding, Context Builder, HTTP, and Supabase adapter
src/features/qa/                     Structured answer, Claim, Evidence, quality, and QA Run orchestration
src/features/workspace/              Workspace domain, mapper, HTTP contract, and Supabase reader
src/components/phase5/               Evidence-first Knowledge Workspace presentation and client integration
src/infrastructure/ai/              Embedding configuration and OpenAI provider adapter
src/infrastructure/storage/         Storage adapter and Supabase implementation
src/infrastructure/supabase/        Server-only Supabase client
src/providers/                      LLM and embedding provider boundaries
supabase/migrations/                Core schema and private bucket configuration
docs/user-task-test.md              Proposed human task-test protocol
demo/                               Fictional enterprise corpus, manifest, validator, and runbook
evals/retrieval/                    Golden Dataset and retrieval evaluation metrics
```

See `architecture-design.md` for the MVP architecture, `demo/README.md` for the
fictional corpus, and `evals/retrieval/README.md` for the offline retrieval
fixture evaluator. The live retrieval evaluator is an internal full-working-tree
tool and is not included in the first public file set.
