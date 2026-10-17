import { RetrievalError } from "@/features/retrieval/application/retrieval-error";
import {
  createRetrievalTraceId,
  parseRetrievalRequest,
  retrievalErrorResponse,
  retrievalResultToHttp,
} from "@/features/retrieval/http/retrieval-http";
import { getRetrievalEngine } from "@/features/retrieval/infrastructure/retrieval-engine-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const traceId = createRetrievalTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch (error) {
      throw new RetrievalError(
        "The request body must be valid JSON.",
        "INVALID_REQUEST",
        400,
        undefined,
        { cause: error },
      );
    }

    const input = parseRetrievalRequest(body);
    const workspace = await requireWorkspace(request, input.knowledgeBaseId);
    const result = await getRetrievalEngine().execute({ ...input, knowledgeBaseId: workspace.knowledgeBaseId });

    return Response.json(retrievalResultToHttp(result, traceId), {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return retrievalErrorResponse(error, traceId);
  }
}
