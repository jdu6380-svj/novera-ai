# Novera AI Public Production Demo Boundary

**Status:** Source behavior documented; activation in the current Production deployment is unverified

The source has an opt-in demo boundary. This document does not prove that the
current Production deployment contains this source version or has the required
environment variable enabled. It also does not prove Preview/Production
resource isolation.

## Runtime boundary

`isPublicDemoMode()` enables the boundary only when
`PUBLIC_DEMO_MODE`, after trimming and lowercasing, equals `true`. It does not
automatically activate based on `VERCEL_ENV`.

- `GET /api/v1/workspace` returns the fictional Asteria Workcloud workspace;
- `GET /api/v1/health` returns `status: "demo"` and does not probe Supabase;
- document upload, document processing, processing retry, document/job reads,
  retrieval, and QA POST endpoints return `403 PUBLIC_DEMO_READ_ONLY`;
- `GET /api/v1/demo/scenarios/{id}` serves only the two preset scenarios.

When the switch is disabled, the health route can query the configured Supabase
project, and authenticated workspace operations can use the live data path.
The switch is not a database-level read-only guarantee and does not establish
that Preview uses a separate project.

Login, signup, email verification, and password recovery call Supabase Auth
directly from the browser and are not blocked by this server-side demo switch.
Do not perform those actions against the current Production deployment until
its Auth project and intended side effects are confirmed.

## Visible UI boundary

Public Production labels the workspace as `预置验证结果` and shows a persistent
`演示数据` banner. Upload controls and the free-form question composer are
hidden. The assistant exposes two deterministic portfolio scenarios:

1. `跨文档分析` — combines retention, release, and onboarding experiment
   sources, with Claim → Evidence → source-line tracing;
2. `知识缺口拒答` — asks for an ARR value absent from the fictional corpus and
   shows an explicit refusal with no claims or Evidence.

Preset metric values are marked as demonstration values. They are not online
retrieval or cost measurements.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test` — 165 tests across 37 files
- `npm run demo:validate`

Historical local test results and fixture checks are not evidence about the
current Production deployment. The real staging smoke, 8-case interview
evaluation, human task test, and feedback iteration remain separate release
gates and cannot be replaced by the public Demo fixtures.
