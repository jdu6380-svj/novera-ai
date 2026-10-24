import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const EMBEDDING_DIMENSION = 1536;
const DEFAULT_KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";

async function loadDotEnv(path: string): Promise<void> {
  if (!existsSync(path)) return;

  const source = await readFile(path, "utf8");

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const name = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (process.env[name] !== undefined) continue;
    process.env[name] = rawValue.replace(/^(['"])(.*)\1$/u, "$2");
  }
}

function environment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metricScore(value: unknown): number | null {
  return isRecord(value) && typeof value.score === "number" && Number.isFinite(value.score)
    ? value.score
    : null;
}

async function main(): Promise<void> {
  await loadDotEnv(ENV_PATH);

  const baseUrl = environment("QA_SMOKE_URL");
  const supabaseUrl = environment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = environment("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = environment("OPENAI_API_KEY");
  const missing = [
    ["QA_SMOKE_URL", baseUrl],
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ["OPENAI_API_KEY", openAiKey],
  ]
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.log(
      JSON.stringify(
        {
          status: "PHASE5_STAGING_SMOKE_SKIPPED",
          reason: `Missing required environment variables: ${missing.join(", ")}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const knowledgeBaseId =
    environment("QA_SMOKE_KNOWLEDGE_BASE_ID") ??
    environment("DEFAULT_KNOWLEDGE_BASE_ID") ??
    DEFAULT_KNOWLEDGE_BASE_ID;
  const embeddingModel = environment("EMBEDDING_MODEL") ?? "text-embedding-3-small";
  const embeddingVersion = environment("EMBEDDING_MODEL_VERSION") ?? embeddingModel;
  const documentId = randomUUID();
  const fixtureKey = `NoveraPhase5-${documentId}`;
  const sourceText = [
    `${fixtureKey} is a temporary Enterprise Knowledge Intelligence staging document.`,
    "The verified cause of activation friction is that new users cannot find the next-step checklist immediately after signup.",
    "The approved product response is to place the checklist on the first workspace screen and measure first-task completion.",
  ].join(" ");
  const query = `According to ${fixtureKey}, what is the verified cause of activation friction and the approved response?`;
  const storagePath = `phase5-staging-smoke/${documentId}.txt`;
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const openai = new OpenAI({
    apiKey: openAiKey!,
    baseURL: environment("OPENAI_BASE_URL") ?? undefined,
  });
  let conversationId: string | null = null;
  let qaRunId: string | null = null;
  const cleanupErrors: string[] = [];

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: embeddingModel,
      input: sourceText,
      dimensions: EMBEDDING_DIMENSION,
      encoding_format: "float",
    });
    const embedding = embeddingResponse.data[0]?.embedding;

    if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Embedding provider did not return ${EMBEDDING_DIMENSION} dimensions.`);
    }

    const { error: documentError } = await supabase.from("documents").insert({
      id: documentId,
      knowledge_base_id: knowledgeBaseId,
      display_name: `Phase 5 Staging Evidence ${fixtureKey}`,
      original_filename: "phase5-staging-evidence.txt",
      mime_type: "text/plain",
      file_extension: "txt",
      storage_bucket: "knowledge-files",
      storage_path: storagePath,
      file_size_bytes: Buffer.byteLength(sourceText, "utf8"),
      sha256: sha256(sourceText),
      status: "uploaded",
      progress_pct: 100,
      metadata: { smoke_test: true, phase: 5, fixture_key: fixtureKey },
      uploaded_at: new Date().toISOString(),
    });

    if (documentError) {
      throw new Error(`Could not create the Phase 5 smoke document (${documentError.code}).`);
    }

    const { error: processingError } = await supabase
      .from("documents")
      .update({ status: "processing", processing_stage: "embed", progress_pct: 80 })
      .eq("id", documentId);

    if (processingError) {
      throw new Error(`Could not transition the smoke document (${processingError.code}).`);
    }

    const { error: chunkError } = await supabase.from("document_chunks").insert({
      document_id: documentId,
      chunk_index: 0,
      text: sourceText,
      text_hash: sha256(sourceText),
      token_count: sourceText.split(/\s+/u).length,
      start_char: 0,
      end_char: sourceText.length,
      section_path: "Phase 5 Staging Evidence",
      metadata: {
        smoke_test: true,
        evidence: {
          sourceDocumentId: documentId,
          sourceDocumentName: `Phase 5 Staging Evidence ${fixtureKey}`,
          sourceSegments: [
            {
              sourceBlockId: "phase5-smoke-block",
              kind: "paragraph",
              normalizedText: sourceText,
              sourceBlockText: sourceText,
              normalizedStartChar: 0,
              normalizedEndChar: sourceText.length,
              locator: {
                pageStart: null,
                pageEnd: null,
                lineStart: 1,
                lineEnd: 1,
                startChar: 0,
                endChar: sourceText.length,
              },
            },
          ],
        },
      },
      embedding,
      embedding_provider: "openai",
      embedding_model: embeddingModel,
      embedding_model_version: embeddingVersion,
      embedding_dimension: EMBEDDING_DIMENSION,
      embedded_at: new Date().toISOString(),
      embedding_status: "ready",
    });

    if (chunkError) {
      throw new Error(`Could not store the smoke embedding (${chunkError.code}).`);
    }

    const { error: readyError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        processing_stage: "finalize",
        progress_pct: 100,
        parser_name: "phase5-staging-smoke",
        parser_version: "1.0.0",
        char_count: sourceText.length,
        token_count: sourceText.split(/\s+/u).length,
        chunk_count: 1,
        processed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (readyError) {
      throw new Error(`Could not publish READY smoke knowledge (${readyError.code}).`);
    }

    const endpoint = new URL("/api/v1/qa/runs", baseUrl!);
    const qaResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        knowledge_base_id: knowledgeBaseId,
        task_type: "analysis",
        document_ids: [documentId],
        top_k: 5,
      }),
    });
    const payload = (await qaResponse.json()) as unknown;

    if (!qaResponse.ok || !isRecord(payload)) {
      throw new Error(
        `QA endpoint failed with HTTP ${qaResponse.status}: ${JSON.stringify(payload)}`,
      );
    }

    qaRunId = typeof payload.qa_run_id === "string" ? payload.qa_run_id : null;
    conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : null;
    const answer = isRecord(payload.answer) ? payload.answer : null;
    const quality = isRecord(payload.quality_scores) ? payload.quality_scores : null;
    const sources = Array.isArray(payload.sources) ? payload.sources.filter(isRecord) : [];
    const claims = answer && Array.isArray(answer.claims) ? answer.claims.filter(isRecord) : [];
    const evidence = claims.flatMap((claim) =>
      Array.isArray(claim.evidence) ? claim.evidence.filter(isRecord) : [],
    );
    const metricValues = quality
      ? [
          metricScore(quality.retrieval_score),
          metricScore(quality.evidence_coverage),
          metricScore(quality.knowledge_match),
          metricScore(quality.confidence),
        ]
      : [];

    if (!qaRunId || !conversationId) throw new Error("QA response did not return persistent IDs.");
    if (payload.status !== "completed") throw new Error(`Expected completed QA status, received ${String(payload.status)}.`);
    if (claims.length === 0) throw new Error("QA response did not contain a Claim.");
    if (!evidence.some((item) => item.document_id === documentId)) {
      throw new Error("QA response did not trace Evidence to the temporary source document.");
    }
    if (!sources.some((item) => item.document_id === documentId)) {
      throw new Error("QA response did not include the temporary Source Document.");
    }
    if (metricValues.length !== 4 || metricValues.some((value) => value === null)) {
      throw new Error("QA response did not contain all four numeric quality metrics.");
    }

    const [runResult, claimResult, evidenceResult] = await Promise.all([
      supabase
        .from("qa_runs")
        .select("id,status,confidence_score,answer_payload")
        .eq("id", qaRunId)
        .single(),
      supabase.from("answer_claims").select("id", { count: "exact" }).eq("qa_run_id", qaRunId),
      supabase
        .from("evidence_items")
        .select("id,document_id", { count: "exact" })
        .eq("qa_run_id", qaRunId)
        .eq("document_id", documentId),
    ]);

    if (runResult.error || runResult.data?.status !== "completed") {
      throw new Error("The completed QA Run was not persisted.");
    }
    if (claimResult.error || !claimResult.count) {
      throw new Error("The QA Claim trace was not persisted.");
    }
    if (evidenceResult.error || !evidenceResult.count) {
      throw new Error("The QA Evidence trace was not persisted against the source document.");
    }

    console.log(
      JSON.stringify(
        {
          status: "PHASE5_STAGING_SMOKE_PASSED",
          document_id: documentId,
          qa_run_id: qaRunId,
          claim_count: claims.length,
          evidence_count: evidence.length,
          source_count: sources.length,
          metrics: {
            retrieval: metricValues[0],
            evidence_coverage: metricValues[1],
            knowledge_match: metricValues[2],
            confidence: metricValues[3],
          },
          trace_id: payload.trace_id,
        },
        null,
        2,
      ),
    );
  } finally {
    if (conversationId) {
      const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
      if (error) cleanupErrors.push(`conversation:${error.code}`);
    }

    const { error: documentCleanupError } = await supabase
      .from("documents")
      .delete()
      .eq("id", documentId);
    if (documentCleanupError) cleanupErrors.push(`document:${documentCleanupError.code}`);

    if (cleanupErrors.length > 0) {
      throw new Error(`Phase 5 smoke cleanup failed: ${cleanupErrors.join(", ")}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    `PHASE5_STAGING_SMOKE_FAILED ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
