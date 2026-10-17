import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { GET } from "./route";

const envKeys = [
  "VERCEL",
  "VERCEL_ENV",
  "SUPABASE_CONNECTIVITY_DEBUG",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.mocked(lookup).mockReset();
  vi.unstubAllGlobals();
});

describe("Supabase connectivity diagnostic route", () => {
  it.each(["production", "preview"])("is disabled on Vercel %s deployments even with the opt-in flag", async (vercelEnv) => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = vercelEnv;
    process.env.SUPABASE_CONNECTIVITY_DEBUG = "1";

    const response = await GET();

    expect(response.status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("is disabled on a Vercel deployment when only the deployment marker is present", async () => {
    process.env.VERCEL = "1";
    delete process.env.VERCEL_ENV;
    process.env.SUPABASE_CONNECTIVITY_DEBUG = "1";

    const response = await GET();

    expect(response.status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("is disabled locally by default", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.SUPABASE_CONNECTIVITY_DEBUG;

    const response = await GET();

    expect(response.status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("runs locally only when explicitly enabled", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.SUPABASE_CONNECTIVITY_DEBUG = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.supabase.co";
    vi.mocked(lookup).mockResolvedValue([{ address: "192.0.2.1", family: 4 }] as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: 200 });
    expect(lookup).toHaveBeenCalledOnce();
  });
});
