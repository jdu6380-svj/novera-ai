import {
  createWorkspaceTraceId,
  parseKnowledgeBaseId,
  workspaceErrorResponse,
  workspaceToHttp,
} from "@/features/workspace/http/workspace-http";
import { getWorkspaceReader } from "@/features/workspace/infrastructure/workspace-reader-factory";
import { publicDemoWorkspaceData } from "@/components/phase5/demo-scenarios";
import { isPublicDemoMode } from "@/infrastructure/deployment/public-demo-mode";
import { authErrorResponse, requireWorkspace, AuthRequiredError } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const traceId = createWorkspaceTraceId();

  try {
    const knowledgeBaseId = parseKnowledgeBaseId(new URL(request.url).searchParams.get("knowledge_base_id"));
    if (isPublicDemoMode()) {
      return Response.json(
        workspaceToHttp({ ...publicDemoWorkspaceData, dataMode: "demo" }, traceId),
        { headers: { "cache-control": "no-store", "x-trace-id": traceId } },
      );
    }
    const resolved = await requireWorkspace(request, knowledgeBaseId);
    const workspace = await getWorkspaceReader().load(resolved.knowledgeBaseId);

    return Response.json(workspaceToHttp({ ...workspace, dataMode: "live" }, traceId), {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return workspaceErrorResponse(error, traceId);
  }
}
