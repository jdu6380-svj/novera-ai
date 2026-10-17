import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain";
import { getEmbeddingIdentityConfig } from "@/infrastructure/ai/embedding-config";
import { getLanguageModelIdentityConfig } from "@/infrastructure/ai/language-model-config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import { isPublicDemoMode } from "@/infrastructure/deployment/public-demo-mode";
import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(name: string): boolean {
  const value = process.env[name]?.trim();
  return Boolean(value && value !== "[SENSITIVE]");
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Health dependency timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

export async function GET(): Promise<Response> {
  if (isPublicDemoMode()) {
    return Response.json(
      {
        product: "Novera AI",
        status: "demo",
        checked_at: new Date().toISOString(),
        dependencies: {
          environment: { configured: true, missing: [] },
          database: { status: "not_checked", default_knowledge_base_ready: false },
          embedding: { provider: "disabled", model: "disabled", model_version: null, dimensions: null, credential_configured: false },
          generation: { provider: "disabled", model: "disabled", prompt_version: null, credential_configured: false },
        },
        data_classification: {
          mode: "public_demo",
          live_api: "Disabled in public Production.",
          demo_corpus: "Fictional Asteria Workcloud portfolio data.",
          fallback_ui: "Preset answers and Evidence only; no shared database writes.",
        },
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const requiredVariables = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const languageProvider = getLanguageModelIdentityConfig().provider.toLowerCase();
  const languageCredential = languageProvider === "deepseek"
    ? "DEEPSEEK_API_KEY"
    : "OPENAI_API_KEY";
  const embeddingCredential = configured("EMBEDDING_API_KEY")
    ? "EMBEDDING_API_KEY"
    : "OPENAI_API_KEY";
  const missingVariables = [
    ...requiredVariables,
    languageCredential,
    embeddingCredential,
  ].filter((name, index, all) => !configured(name) && all.indexOf(name) === index);
  if (!getPublicSupabaseKey()) {
    missingVariables.push("NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  const embedding = getEmbeddingIdentityConfig();
  const language = getLanguageModelIdentityConfig();
  let database: "connected" | "unavailable" | "not_checked" = "not_checked";
  let knowledgeBaseReady = false;

  if (
    configured("NEXT_PUBLIC_SUPABASE_URL") &&
    configured("SUPABASE_SERVICE_ROLE_KEY")
  ) {
    try {
      const { data, error } = await withTimeout(
        (signal) =>
          getSupabaseAdminClient()
            .from("knowledge_bases")
            .select("id")
            .eq(
              "id",
              process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim() || DEFAULT_KNOWLEDGE_BASE_ID,
            )
            .abortSignal(signal)
            .maybeSingle(),
        5_000,
      );

      database = error ? "unavailable" : "connected";
      knowledgeBaseReady = Boolean(data && !error);
    } catch {
      database = "unavailable";
    }
  }

  const ready =
    missingVariables.length === 0 &&
    database === "connected" &&
    knowledgeBaseReady;

  return Response.json(
    {
      product: "Novera AI",
      status: ready ? "ready" : "blocked",
      checked_at: new Date().toISOString(),
      dependencies: {
        environment: {
          configured: missingVariables.length === 0,
          missing: missingVariables,
        },
        database: {
          status: database,
          default_knowledge_base_ready: knowledgeBaseReady,
        },
        embedding: {
          provider: embedding.provider,
          model: embedding.model,
          model_version: embedding.modelVersion,
          dimensions: embedding.dimensions,
          credential_configured: configured(embeddingCredential),
        },
        generation: {
          provider: language.provider,
          model: language.model,
          prompt_version: language.promptVersion,
          credential_configured: configured(languageCredential),
        },
      },
      data_classification: {
        live_api: "Real Supabase and provider configuration when status is ready.",
        demo_corpus: "Fictional Asteria Workcloud portfolio data.",
        fallback_ui: "Clearly labelled demo mode; never evidence of a live RAG pass.",
      },
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
