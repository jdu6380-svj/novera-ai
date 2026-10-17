export function isPublicDemoMode(): boolean {
  // Production is the long-lived authenticated product entry point. Keep the
  // demo available only as an explicit opt-in for isolated preview checks.
  return process.env.PUBLIC_DEMO_MODE?.trim().toLowerCase() === "true";
}

export function publicDemoReadOnlyResponse(traceId: string): Response | null {
  if (!isPublicDemoMode()) return null;

  return Response.json(
    {
      error: {
        code: "PUBLIC_DEMO_READ_ONLY",
        message: "Public Production is a read-only demo. Use the protected Validation environment for live RAG operations.",
        trace_id: traceId,
      },
      data_mode: "demo",
    },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "x-trace-id": traceId,
      },
    },
  );
}
