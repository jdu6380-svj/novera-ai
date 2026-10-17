import {
  createProcessingTraceId,
  processingErrorResponse,
  processingJobToHttp,
} from "@/features/knowledge-processing/http/document-processing-http";
import { getDocumentProcessingService } from "@/features/knowledge-processing/infrastructure/document-processing-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { assertProcessingJobInWorkspace, authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";

interface ProcessingJobRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: ProcessingJobRouteContext,
): Promise<Response> {
  const traceId = createProcessingTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(_request);
    await assertProcessingJobInWorkspace(id, workspace.knowledgeBaseId);
    const job = await getDocumentProcessingService().getJob(id);

    return Response.json(
      { job: processingJobToHttp(job), trace_id: traceId },
      { headers: { "x-trace-id": traceId } },
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return processingErrorResponse(error, traceId);
  }
}
