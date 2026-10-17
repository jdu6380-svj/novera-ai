import { after } from "next/server";

import {
  createProcessingTraceId,
  processingDocumentToHttp,
  processingErrorResponse,
  processingJobToHttp,
} from "@/features/knowledge-processing/http/document-processing-http";
import {
  getDocumentProcessingService,
  runDocumentProcessingInBackground,
} from "@/features/knowledge-processing/infrastructure/document-processing-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { assertProcessingJobInWorkspace, authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RetryProcessingJobRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: RetryProcessingJobRouteContext,
): Promise<Response> {
  const traceId = createProcessingTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(_request);
    await assertProcessingJobInWorkspace(id, workspace.knowledgeBaseId);
    const result = await getDocumentProcessingService().retry(id);

    if (result.job.status === "pending") {
      after(() => runDocumentProcessingInBackground(result.job.id, traceId));
    }

    return Response.json(
      {
        document: processingDocumentToHttp(result.document),
        job: processingJobToHttp(result.job),
        idempotent: result.idempotent,
        trace_id: traceId,
      },
      { status: result.idempotent ? 200 : 202, headers: { "x-trace-id": traceId } },
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return processingErrorResponse(error, traceId);
  }
}
