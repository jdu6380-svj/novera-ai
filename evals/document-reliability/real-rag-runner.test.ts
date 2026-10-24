import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runDocumentReliabilityMode } from "./real-rag-runner";

const mode = process.env.NOVERA_DOCUMENT_RAG_MODE;
const supportedMode = mode === "prepare" || mode === "prepare-v2" || mode === "prepare-v3" || mode === "smoke" || mode === "full" || mode === "full-v2" || mode === "full-v3" || mode === "rescore-v3" || mode === "generation-smoke" || mode === "generation-replay";

describe.skipIf(!supportedMode)("Novera document reliability real RAG runner", () => {
  it("runs only the explicitly selected local preflight or budget-approved live mode", async () => {
    if (!supportedMode) return;
    const result = await runDocumentReliabilityMode(mode);
    if (mode === "generation-smoke" || mode === "generation-replay") {
      const generation = result.result.generation as Record<string, unknown> | undefined;
      console.info(JSON.stringify({
        artifact_path: result.artifactPath,
        status: result.result.status,
        http_status: generation?.http_status ?? null,
        generated_non_empty: generation?.non_empty ?? false,
        error: generation?.error ?? null,
      }, null, 2));
      return;
    }
    if (mode === "full" || mode === "full-v2" || mode === "full-v3" || mode === "rescore-v3") {
      const aggregate = result.result.aggregate as Record<string, unknown> | undefined;
      const requests = result.result.requests as Record<string, unknown> | undefined;
      const documents = result.result.documents;
      const cases = result.result.cases;
      console.info(JSON.stringify({
        artifact_path: result.artifactPath,
        status: aggregate?.status ?? "UNKNOWN",
        documents_recorded: Array.isArray(documents) ? documents.length : 0,
        cases_recorded: Array.isArray(cases) ? cases.length : 0,
        aggregate,
        requests,
        failed_case_ids: Array.isArray(cases)
          ? cases.map((item) => item as Record<string, unknown>)
            .filter((item) => (item.evaluation as Record<string, unknown> | undefined)?.status !== "PASS")
            .map((item) => item.case_id)
          : [],
      }, null, 2));
      return;
    }
    console.info(JSON.stringify({ artifact_path: result.artifactPath, result: result.result }, null, 2));
  }, 20 * 60 * 1000);
});
