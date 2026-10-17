import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain";
import { getEmbeddingIdentityConfig } from "@/infrastructure/ai/embedding-config";
import { getLanguageModelIdentityConfig } from "@/infrastructure/ai/language-model-config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import { isPublicDemoMode } from "@/infrastructure/deployment/public-demo-mode";
import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicHealthResponse(status: "demo" | "ready" | "blocked", httpStatus: 200 | 503): Response {
  return Response.json(
    {
      product: "Novera AI",
      status,
      checked_at: new Date().toISOString(),
    },
    { status: httpStatus, headers: { "cache-control": "no-store" } },
  );
}

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
    return publicHealthResponse("demo", 200);
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
  getEmbeddingIdentityConfig();
  getLanguageModelIdentityConfig();
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

  return publicHealthResponse(ready ? "ready" : "blocked", ready ? 200 : 503);
}
