import { after } from "next/server";

import {
  createTraceId,
  documentToHttp,
  errorResponse,
} from "@/features/documents/http/document-upload-http";
import { getDocumentUploadService } from "@/features/documents/infrastructure/document-upload-service-factory";
import {
  getDocumentProcessingService,
  runDocumentProcessingInBackground,
} from "@/features/knowledge-processing/infrastructure/document-processing-service-factory";
import {
  processingDocumentToHttp,
  processingJobToHttp,
} from "@/features/knowledge-processing/http/document-processing-http";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { assertDocumentInWorkspace, authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface CompleteUploadRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: CompleteUploadRouteContext,
): Promise<Response> {
  const traceId = createTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(_request);
    await assertDocumentInWorkspace(id, workspace.knowledgeBaseId);
    const result = await getDocumentUploadService().complete(id);
    let processing:
      | {
          document: ReturnType<typeof processingDocumentToHttp>;
          job: ReturnType<typeof processingJobToHttp>;
          idempotent: boolean;
        }
      | null = null;

    try {
      const processingResult = await getDocumentProcessingService().enqueue(id);
      processing = {
        document: processingDocumentToHttp(processingResult.document),
        job: processingJobToHttp(processingResult.job),
        idempotent: processingResult.idempotent,
      };

      if (processingResult.job.status === "pending") {
        after(() => runDocumentProcessingInBackground(processingResult.job.id, traceId));
      }
    } catch (processingError) {
      // Upload completion is durable independently of processing. Keep the
      // upload response successful, while leaving an explicit server-side
      // signal for operators to retry through /process.
      console.error("Document uploaded but processing could not be enqueued", {
        traceId,
        documentId: id,
        processingError,
      });
    }

    return Response.json(
      {
        document: documentToHttp(result.document),
        processing,
        idempotent: result.idempotent,
        trace_id: traceId,
      },
      { headers: { "x-trace-id": traceId } },
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return errorResponse(error, traceId);
  }
}
