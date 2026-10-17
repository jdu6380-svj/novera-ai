import "server-only";

import { SupabaseWorkspaceReader } from "./supabase-workspace-reader";

let reader: SupabaseWorkspaceReader | undefined;

export function getWorkspaceReader(): SupabaseWorkspaceReader {
  reader ??= new SupabaseWorkspaceReader();
  return reader;
}
