"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";

let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = getPublicSupabaseKey();
    if (!url || !key) throw new Error("登录服务尚未配置，请联系管理员。");
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const supabase = getSupabaseBrowserClient();

  async function send(token: string | null): Promise<Response> {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }

  const response = await send(await getAccessToken());
  if (response.status !== 401) return response;

  // A tab can retain a stale access token after the server has restarted or
  // the short-lived token has expired. Refresh once before surfacing 401 so a
  // normal upload or workspace refresh does not look like a generic failure.
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) return response;
  return send(data.session.access_token);
}
