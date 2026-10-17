import { DocumentUploadError } from "@/features/documents/application/document-upload-error";
import {
  createTraceId,
  documentToHttp,
  errorResponse,
  parseInitializeRequest,
} from "@/features/documents/http/document-upload-http";
import { getDocumentUploadService } from "@/features/documents/infrastructure/document-upload-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const traceId = createTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch (error) {
      throw new DocumentUploadError(
        "The request body must be valid JSON.",
        "INVALID_REQUEST",
        400,
        undefined,
        { cause: error },
      );
    }

    const input = parseInitializeRequest(body);
    const workspace = await requireWorkspace(request, input.knowledgeBaseId);
    const result = await getDocumentUploadService().initialize({
      ...input,
      knowledgeBaseId: workspace.knowledgeBaseId,
    });

    return Response.json(
      {
        document: documentToHttp(result.document),
        upload: {
          bucket: result.upload.bucket,
          path: result.upload.path,
          token: result.upload.token,
          signed_url: result.upload.signedUrl,
          expires_at: result.upload.expiresAt,
        },
        trace_id: traceId,
      },
      { status: 201, headers: { "x-trace-id": traceId } },
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return errorResponse(error, traceId);
  }
}
