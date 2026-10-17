import "server-only";

import { setDefaultResultOrder } from "node:dns";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | undefined;

// Some local networks reset Supabase's IPv6 TLS connection while IPv4 is
// healthy. Prefer IPv4 for server-side requests so auth, workspace, and
// storage initialization do not fail before reaching Supabase.
setDefaultResultOrder("ipv4first");

function requireServerEnvironment(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

/**
 * Service-role Supabase client. This module must never be imported by Client Components.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
      requireServerEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  }

  return adminClient;
}
