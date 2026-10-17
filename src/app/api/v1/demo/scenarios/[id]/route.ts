import { getDemoScenario, publicDemoWorkspaceData, type DemoScenarioId } from "@/components/phase5/demo-scenarios";
import { createWorkspaceTraceId, workspaceToHttp } from "@/features/workspace/http/workspace-http";
import { isPublicDemoMode } from "@/infrastructure/deployment/public-demo-mode";

export const runtime = "nodejs";

const SCENARIO_IDS: readonly DemoScenarioId[] = [
  "cross-document-analysis",
  "knowledge-gap-refusal",
];

interface DemoScenarioRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: DemoScenarioRouteContext): Promise<Response> {
  const traceId = createWorkspaceTraceId();
  const { id } = await context.params;

  if (!isPublicDemoMode()) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Demo scenarios are available on public Production only.", trace_id: traceId } },
      { status: 404, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
    );
  }

  if (!SCENARIO_IDS.includes(id as DemoScenarioId)) {
    return Response.json(
      { error: { code: "DEMO_SCENARIO_NOT_FOUND", message: "The requested preset scenario does not exist.", trace_id: traceId } },
      { status: 404, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
    );
  }

  return Response.json(
    workspaceToHttp({
      ...publicDemoWorkspaceData,
      dataMode: "demo",
      answer: getDemoScenario(id as DemoScenarioId),
    }, traceId),
    { headers: { "cache-control": "no-store", "x-trace-id": traceId } },
  );
}
