import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/infrastructure/supabase/proxy";

export async function proxy(request: NextRequest) {
  const response = await updateSupabaseSession(request);
  if (request.nextUrl.pathname.startsWith("/login") || request.nextUrl.pathname.startsWith("/auth")) {
    return response;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
