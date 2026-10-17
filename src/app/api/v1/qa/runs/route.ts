import {
  createQaRunTraceId,
  parseQaRunRequest,
  QaRunHttpError,
  qaRunErrorResponse,
  qaRunResultToHttp,
} from "@/features/qa/http/qa-run-http";
import { getQaRunService } from "@/features/qa/infrastructure/qa-run-service-factory";
import { publicDemoReadOnlyResponse } from "@/infrastructure/deployment/public-demo-mode";
import { authErrorResponse, AuthRequiredError, requireWorkspace } from "@/infrastructure/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const traceId = createQaRunTraceId();
  const readOnlyResponse = publicDemoReadOnlyResponse(traceId);
  if (readOnlyResponse) return readOnlyResponse;

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch (error) {
      throw new QaRunHttpError(
        "The request body must be valid JSON.",
        "INVALID_REQUEST",
        400,
        undefined,
        { cause: error },
      );
    }

    const input = parseQaRunRequest(body);
    const workspace = await requireWorkspace(request, input.knowledgeBaseId);
    const result = await getQaRunService().execute({ ...input, knowledgeBaseId: workspace.knowledgeBaseId });

    return Response.json(qaRunResultToHttp(result, traceId), {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authErrorResponse(error, traceId);
    return qaRunErrorResponse(error, traceId);
  }
}
