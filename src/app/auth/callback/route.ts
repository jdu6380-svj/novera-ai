import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";

function redirectWithAuthError(request: NextRequest, code: string): NextResponse {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  const flowType = request.nextUrl.searchParams.get("type");
  const incomingError = request.nextUrl.searchParams.get("error_code") ?? request.nextUrl.searchParams.get("error");
  if (incomingError) return redirectWithAuthError(request, incomingError);
  if (!code) return NextResponse.redirect(new URL("/", request.url));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = getPublicSupabaseKey();
  if (!supabaseUrl || !supabaseKey) return redirectWithAuthError(request, "configuration_missing");

  const response = NextResponse.redirect(new URL(flowType === "recovery" ? "/auth/reset" : "/", request.url));
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectWithAuthError(request, "confirmation_failed");

  return response;
}
