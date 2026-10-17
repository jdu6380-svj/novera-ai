import { describe, expect, it } from "vitest";

import { getPublicSupabaseKey } from "@/infrastructure/supabase/public-config";

describe("getPublicSupabaseKey", () => {
  it("prefers a configured legacy anon key", () => {
    expect(getPublicSupabaseKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: " anon-key ",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    })).toBe("anon-key");
  });

  it("falls back to the publishable key", () => {
    expect(getPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " publishable-key " }))
      .toBe("publishable-key");
  });

  it("returns undefined when neither key is configured", () => {
    expect(getPublicSupabaseKey({})).toBeUndefined();
  });
});
