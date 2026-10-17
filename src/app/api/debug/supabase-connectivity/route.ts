import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 8_000;

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function isEnabled(): boolean {
  // Vercel system variables identify deployments regardless of their target environment.
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV?.trim()) return false;

  return process.env.SUPABASE_CONNECTIVITY_DEBUG === "1";
}

function supabaseHost(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configuredUrl) throw new Error("Missing Supabase URL configuration.");

  const url = new URL(configuredUrl);
  if (url.protocol !== "https:") throw new Error("Supabase URL must use HTTPS.");
  return url.hostname;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
  }

  if (error instanceof Error && error.cause !== undefined) {
    const cause = error.cause;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
    }
  }

  return "NETWORK_ERROR";
}

export async function GET(): Promise<Response> {
  const traceId = randomUUID();

  if (!isEnabled()) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const host = supabaseHost();
    const addresses = (await lookup(host, { all: true, verbatim: true })) as ResolvedAddress[];

    if (addresses.length === 0) {
      return Response.json(
        { success: false, status: null, latency_ms: null, host, error_code: "DNS_EMPTY", trace_id: traceId },
        { status: 503, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
      );
    }

    const startedAt = Date.now();
    let status: number | null = null;
    let failureCode: string | undefined;

    try {
      // Use the same global fetch path as the server SDK. Node 24 honors
      // NODE_USE_ENV_PROXY=1 plus HTTPS_PROXY/HTTP_PROXY when configured.
      const response = await fetch(`https://${host}/auth/v1/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      await response.arrayBuffer();
    } catch (error) {
      failureCode = errorCode(error);
    }

    const latencyMs = Date.now() - startedAt;

    return Response.json(
      {
        success: status !== null,
        status,
        latency_ms: latencyMs,
        host,
        resolved_addresses: addresses,
        ...(failureCode ? { error_code: failureCode } : {}),
        trace_id: traceId,
      },
      {
        status: status !== null ? 200 : 503,
        headers: { "cache-control": "no-store", "x-trace-id": traceId },
      },
    );
  } catch (error) {
    const code = errorCode(error);
    console.error("Supabase connectivity diagnostic failed", { traceId, error_code: code });
    return Response.json(
      { success: false, status: null, latency_ms: null, error_code: code, trace_id: traceId },
      { status: 503, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
    );
  }
}
