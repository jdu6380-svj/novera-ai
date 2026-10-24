const configuredBaseUrl = process.env.QA_SMOKE_URL?.trim();

if (!configuredBaseUrl) {
  console.log(
    JSON.stringify(
      {
        status: "QA_STAGING_SMOKE_SKIPPED",
        reason: "QA_SMOKE_URL is not configured.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const baseUrl = configuredBaseUrl.replace(/\/$/u, "");
const knowledgeBaseId =
  process.env.QA_SMOKE_KNOWLEDGE_BASE_ID ??
  "00000000-0000-4000-8000-000000000001";
const query = process.env.QA_SMOKE_QUERY ?? "What are the main knowledge-backed findings?";

const response = await fetch(`${baseUrl}/api/v1/qa/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query,
    knowledge_base_id: knowledgeBaseId,
    task_type: "analysis",
  }),
});
const payload = (await response.json()) as Record<string, unknown>;

if (!response.ok) {
  throw new Error(`QA staging smoke failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
}

const answer = payload.answer;
const quality = payload.quality_scores;

if (
  !answer ||
  typeof answer !== "object" ||
  !Array.isArray((answer as { claims?: unknown }).claims) ||
  !quality ||
  typeof quality !== "object" ||
  !((quality as { confidence?: unknown }).confidence)
) {
  throw new Error("QA staging smoke response is missing Answer -> Claims or quality scores.");
}

console.log(
  JSON.stringify(
    {
      status: payload.status,
      qa_run_id: payload.qa_run_id,
      claim_count: (answer as { claims: unknown[] }).claims.length,
      confidence: (quality as { confidence: unknown }).confidence,
      trace_id: payload.trace_id,
    },
    null,
    2,
  ),
);
