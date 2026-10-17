import {
  createTraceId,
  errorResponse,
} from "@/features/documents/http/document-upload-http";
import { getDocumentUploadService } from "@/features/documents/infrastructure/document-upload-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import {
  assertDocumentInWorkspace,
  authErrorResponse,
  AuthRequiredError,
  requireWorkspace,
} from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";

interface DocumentDownloadRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: DocumentDownloadRouteContext): Promise<Response> {
  const traceId = createTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    const { id } = await context.params;
    const workspace = await requireWorkspace(request);
    await assertDocumentInWorkspace(id, workspace.knowledgeBaseId);
    const preview = await getDocumentUploadService().createPreview(id);
    return Response.json({
      document: {
        id: preview.document.id,
        name: preview.document.displayName,
        original_filename: preview.document.originalFilename,
        mime_type: preview.document.mimeType,
        size_bytes: preview.document.fileSizeBytes,
        uploaded_at: preview.document.uploadedAt,
        created_at: preview.document.createdAt,
      },
      download_url: preview.signedUrl,
      expires_at: preview.expiresAt,
      trace_id: traceId,
    }, { headers: { "cache-control": "no-store", "x-trace-id": traceId } });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return errorResponse(error, traceId);
  }
}
