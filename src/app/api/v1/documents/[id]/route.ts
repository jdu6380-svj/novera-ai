import {
  createProcessingTraceId,
  processingDocumentToHttp,
  processingErrorResponse,
  processingJobToHttp,
} from "@/features/knowledge-processing/http/document-processing-http";
import { getDocumentProcessingService } from "@/features/knowledge-processing/infrastructure/document-processing-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { assertDocumentInWorkspace, authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";
import { getDocumentUploadService } from "@/features/documents/infrastructure/document-upload-service-factory";
import { errorResponse } from "@/features/documents/http/document-upload-http";

export const runtime = "nodejs";

interface DocumentRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const traceId = createProcessingTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(_request);
    await assertDocumentInWorkspace(id, workspace.knowledgeBaseId);
    const result = await getDocumentProcessingService().getDocument(id);

    return Response.json(
      {
        document: processingDocumentToHttp(result.document),
        latest_job: result.latestJob ? processingJobToHttp(result.latestJob) : null,
        trace_id: traceId,
      },
      { headers: { "x-trace-id": traceId } },
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return processingErrorResponse(error, traceId);
  }
}

export async function DELETE(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const traceId = createProcessingTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(request);
    await assertDocumentInWorkspace(id, workspace.knowledgeBaseId);
    const result = await getDocumentUploadService().delete(id);
    return Response.json({ ...result, trace_id: traceId }, {
      headers: { "cache-control": "no-store", "x-trace-id": traceId },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return errorResponse(error, traceId);
  }
}
