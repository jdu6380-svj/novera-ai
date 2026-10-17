import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/deployment/public-demo-mode", () => ({
  isPublicDemoMode: vi.fn(),
}));
vi.mock("@/infrastructure/ai/embedding-config", () => ({
  getEmbeddingIdentityConfig: vi.fn(),
}));
vi.mock("@/infrastructure/ai/language-model-config", () => ({
  getLanguageModelIdentityConfig: vi.fn(),
}));
vi.mock("@/infrastructure/supabase/public-config", () => ({
  getPublicSupabaseKey: vi.fn(),
}));
vi.mock("@/infrastructure/supabase/admin-client", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getEmbeddingIdentityConfig } from "@/infrastructure/ai/embedding-config";
import { getLanguageModelIdentityConfig } from "@/infrastructure/ai/language-model-config";
import { isPublicDemoMode } from "@/infrastructure/deployment/public-demo-mode";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";
import { GET } from "./route";

const envKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "EMBEDDING_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const publicKeys = vi.mocked(getPublicSupabaseKey);
const demoMode = vi.mocked(isPublicDemoMode);
const embeddingIdentity = vi.mocked(getEmbeddingIdentityConfig);
const languageIdentity = vi.mocked(getLanguageModelIdentityConfig);
const adminClient = vi.mocked(getSupabaseAdminClient);

function configureDatabase(result: { data: { id: string } | null; error: unknown }): void {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const abortSignal = vi.fn().mockReturnValue({ maybeSingle });
  const eq = vi.fn().mockReturnValue({ abortSignal });
  const select = vi.fn().mockReturnValue({ eq });
  adminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) } as never);
}

function expectMinimalBody(body: Record<string, unknown>, status: string): void {
  expect(body).toEqual({
    product: "Novera AI",
    status,
    checked_at: expect.any(String),
  });
  expect(JSON.stringify(body)).not.toMatch(/provider|model|missing|credential|database|knowledge_base|dimension/i);
}

beforeEach(() => {
  demoMode.mockReturnValue(false);
  publicKeys.mockReturnValue("public-key-placeholder");
  embeddingIdentity.mockReturnValue({
    provider: "openai",
    model: "embedding-placeholder",
    modelVersion: "version-placeholder",
    dimensions: 1536,
  });
  languageIdentity.mockReturnValue({
    provider: "deepseek",
    model: "model-placeholder",
    promptVersion: "prompt-placeholder",
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-placeholder";
  process.env.OPENAI_API_KEY = "provider-key-placeholder";
  process.env.EMBEDDING_API_KEY = "embedding-key-placeholder";
  process.env.DEEPSEEK_API_KEY = "language-key-placeholder";
  configureDatabase({ data: { id: "00000000-0000-4000-8000-000000000001" }, error: null });
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.clearAllMocks();
});

describe("public health contract", () => {
  it("returns only minimal status information in demo mode", async () => {
    demoMode.mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expectMinimalBody(await response.json(), "demo");
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("returns a minimal ready response when all health checks pass", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expectMinimalBody(await response.json(), "ready");
  });

  it("does not report healthy when required configuration is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await GET();

    expect(response.status).toBe(503);
    expectMinimalBody(await response.json(), "blocked");
  });

  it("does not report healthy when the database check fails", async () => {
    configureDatabase({ data: null, error: new Error("database unavailable") });

    const response = await GET();

    expect(response.status).toBe(503);
    expectMinimalBody(await response.json(), "blocked");
  });
});
