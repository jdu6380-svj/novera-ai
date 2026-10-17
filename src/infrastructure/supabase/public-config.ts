/**
 * Supabase's current Vercel integration names the browser-safe key
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; older projects use the anon name.
 * Keep both accepted while the product transitions between integration versions.
 */
type PublicSupabaseEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
>>;

export function getPublicSupabaseKey(environment?: PublicSupabaseEnvironment): string | undefined {
  const anonKey = environment
    ? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const publishableKey = environment
    ? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  return anonKey || publishableKey;
}
