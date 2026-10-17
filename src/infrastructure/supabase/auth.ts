import "server-only";

import type { User } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import { DEFAULT_KNOWLEDGE_BASE_ID } from "@/domain";

export class AuthRequiredError extends Error {
  readonly status = 401;

  constructor(message = "请先登录后再访问知识库。") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export interface AuthenticatedWorkspace {
  user: User;
  knowledgeBaseId: string;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function requireUser(request: Request): Promise<User> {
  const token = bearerToken(request);
  if (!token) throw new AuthRequiredError();

  const { data, error } = await getSupabaseAdminClient().auth.getUser(token);
  if (error || !data.user) throw new AuthRequiredError();
  return data.user;
}

export async function getAuthenticatedWorkspace(request: Request): Promise<AuthenticatedWorkspace> {
  const user = await requireUser(request);
  const client = getSupabaseAdminClient();
  const { data: existing, error: readError } = await client
    .from("knowledge_bases")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) {
    throw new Error("用户工作区暂时无法加载。", { cause: readError });
  }

  if (existing?.id) return { user, knowledgeBaseId: existing.id };

  const suffix = user.id.replaceAll("-", "").slice(0, 12).toLowerCase();
  const { data: created, error: createError } = await client
    .from("knowledge_bases")
    .insert({
      owner_id: user.id,
      slug: `workspace-${suffix}`,
      name: "我的知识空间",
      description: "仅你可以访问的企业知识与证据工作区。",
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    const { data: raced } = await client
      .from("knowledge_bases")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (raced?.id) return { user, knowledgeBaseId: raced.id };
    throw new Error("用户工作区暂时无法创建。", { cause: createError });
  }

  return { user, knowledgeBaseId: created.id };
}

export async function requireWorkspace(request: Request, requestedWorkspaceId?: string): Promise<AuthenticatedWorkspace> {
  const workspace = await getAuthenticatedWorkspace(request);
  if (
    requestedWorkspaceId &&
    requestedWorkspaceId !== DEFAULT_KNOWLEDGE_BASE_ID &&
    requestedWorkspaceId !== workspace.knowledgeBaseId
  ) {
    throw new AuthRequiredError("你没有权限访问这个知识空间。");
  }
  return workspace;
}

export function authErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof AuthRequiredError) {
    return Response.json(
      { error: { code: "AUTH_REQUIRED", message: error.message, trace_id: traceId } },
      { status: 401, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
    );
  }

  console.error("Authentication boundary failed", { traceId, error });
  return Response.json(
    { error: { code: "AUTH_UNAVAILABLE", message: "登录状态暂时无法验证，请稍后重试。", trace_id: traceId } },
    { status: 503, headers: { "cache-control": "no-store", "x-trace-id": traceId } },
  );
}

export async function assertDocumentInWorkspace(documentId: string, knowledgeBaseId: string): Promise<void> {
  const { data, error } = await getSupabaseAdminClient()
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("knowledge_base_id", knowledgeBaseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new AuthRequiredError("你没有权限访问这份文档。");
}

export async function assertProcessingJobInWorkspace(jobId: string, knowledgeBaseId: string): Promise<void> {
  const { data, error } = await getSupabaseAdminClient()
    .from("document_processing_jobs")
    .select("id,documents!inner(knowledge_base_id,deleted_at)")
    .eq("id", jobId)
    .eq("documents.knowledge_base_id", knowledgeBaseId)
    .is("documents.deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new AuthRequiredError("你没有权限访问这条处理记录。");
}
