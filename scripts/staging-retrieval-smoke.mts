import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const dotenvPath = resolve(process.cwd(), ".env.local");
const EMBEDDING_DIMENSION = 1536;
const DEFAULT_KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";

async function loadDotEnv(path: string): Promise<void> {
  if (!existsSync(path)) {
    return;
  }

  const source = await readFile(path, "utf8");

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const name = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();

    if (process.env[name] !== undefined) {
      continue;
    }

    process.env[name] = rawValue.replace(/^(['"])(.*)\1$/u, "$2");
  }
}

function requiredEnvironment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
}

function embeddingModelVersion(model: string): string {
  return process.env.EMBEDDING_MODEL_VERSION?.trim() || model;
}

async function main(): Promise<void> {
  await loadDotEnv(dotenvPath);

  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = requiredEnvironment("OPENAI_API_KEY");
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ["OPENAI_API_KEY", openAiKey],
  ]
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(
      `STAGING_SMOKE_SKIPPED missing required environment variables: ${missing.join(", ")}`,
    );
    process.exitCode = 2;
    return;
  }

  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const openai = new OpenAI({
    apiKey: openAiKey!,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
  });
  const model = embeddingModel();
  const modelVersion = embeddingModelVersion(model);
  const knowledgeBaseId =
    process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim() || DEFAULT_KNOWLEDGE_BASE_ID;
  const documentId = randomUUID();
  const storagePath = `staging-smoke/${documentId}.txt`;
  const sourceText = `Novera staging retrieval smoke fixture ${documentId}: activation friction is caused by an unclear next step after signup.`;
  const queryText = "What causes activation friction immediately after signup?";
  let cleanupError: unknown;

  try {
    const embeddingResponse = await openai.embeddings.create({
      model,
      input: [sourceText, queryText],
      dimensions: EMBEDDING_DIMENSION,
      encoding_format: "float",
    });
    const documentVector = embeddingResponse.data.find((item) => item.index === 0)?.embedding;
    const queryVector = embeddingResponse.data.find((item) => item.index === 1)?.embedding;

    if (
      !documentVector ||
      !queryVector ||
      documentVector.length !== EMBEDDING_DIMENSION ||
      queryVector.length !== EMBEDDING_DIMENSION ||
      documentVector.some((value) => !Number.isFinite(value)) ||
      queryVector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Embedding response did not contain two ${EMBEDDING_DIMENSION}-dimension finite vectors.`,
      );
    }

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .insert({
        id: documentId,
        knowledge_base_id: knowledgeBaseId,
        display_name: `Staging Retrieval Smoke ${documentId}`,
        original_filename: "staging-retrieval-smoke.txt",
        mime_type: "text/plain",
        file_extension: "txt",
        storage_bucket: "knowledge-files",
        storage_path: storagePath,
        file_size_bytes: Buffer.byteLength(sourceText, "utf8"),
        sha256: sha256(sourceText),
        status: "uploaded",
        processing_stage: null,
        progress_pct: 100,
        metadata: { smoke_test: true, phase: 3 },
        uploaded_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (documentError || !document) {
      throw new Error(`Could not create smoke document (${documentError?.code ?? "unknown"}).`);
    }

    const { error: processingError } = await supabase
      .from("documents")
      .update({
        status: "processing",
        processing_stage: "embed",
        progress_pct: 80,
      })
      .eq("id", document.id);

    if (processingError) {
      throw new Error(
        `Could not move smoke document into processing (${processingError.code ?? "unknown"}).`,
      );
    }

    const { error: chunkError } = await supabase.from("document_chunks").insert({
      document_id: document.id,
      chunk_index: 0,
      text: sourceText,
      text_hash: sha256(sourceText),
      token_count: sourceText.split(/\s+/u).length,
      start_char: 0,
      end_char: sourceText.length,
      section_path: "Smoke Test",
      metadata: {
        source: { displayName: "Staging Retrieval Smoke", mimeType: "text/plain" },
        evidence: {
          sourceDocumentId: document.id,
          sourceSegments: [
            {
              sourceBlockId: "staging-smoke-block",
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
      embedding: documentVector,
      embedding_provider: "openai",
      embedding_model: model,
      embedding_model_version: modelVersion,
      embedding_dimension: EMBEDDING_DIMENSION,
      embedded_at: new Date().toISOString(),
      embedding_status: "ready",
    });

    if (chunkError) {
      throw new Error(`Could not persist smoke chunk (${chunkError.code ?? "unknown"}).`);
    }

    const { error: publishError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        processing_stage: "finalize",
        progress_pct: 100,
        parser_name: "staging-smoke-fixture",
        parser_version: "1.0.0",
        char_count: sourceText.length,
        token_count: sourceText.split(/\s+/u).length,
        chunk_count: 1,
        processed_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    if (publishError) {
      throw new Error(`Could not publish smoke document (${publishError.code ?? "unknown"}).`);
    }

    const { data: matches, error: matchError } = await supabase.rpc(
      "match_document_chunks",
      {
        query_embedding: queryVector,
        knowledge_base: knowledgeBaseId,
        match_count: 5,
        similarity_threshold: 0.35,
        filter_document_ids: [document.id],
      },
    );

    if (matchError || !Array.isArray(matches)) {
      throw new Error(`Similarity query failed (${matchError?.code ?? "unknown"}).`);
    }

    const match = matches.find((item) => item?.document_id === document.id);

    if (!match) {
      throw new Error("The inserted smoke chunk was not returned by similarity search.");
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          document_id: document.id,
          chunk_id: match.chunk_id,
          result_count: matches.length,
          similarity_score: match.similarity_score,
          embedding_model: model,
          embedding_dimension: EMBEDDING_DIMENSION,
        },
        null,
        2,
      ),
    );
  } finally {
    const { error } = await supabase.from("documents").delete().eq("id", documentId);
    cleanupError = error;
  }

  if (cleanupError) {
    throw new Error("Smoke test passed, but exact temporary-document cleanup failed.");
  }
}

main().catch((error: unknown) => {
  console.error(
    `STAGING_SMOKE_FAILED ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
