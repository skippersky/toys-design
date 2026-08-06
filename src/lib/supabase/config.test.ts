import { describe, expect, it } from "vitest";

import { isSupabaseConfigured } from "@/lib/supabase/config";

describe("Supabase public configuration", () => {
  it("rejects missing and template placeholder credentials", () => {
    expect(isSupabaseConfigured("", "")).toBe(false);
    expect(
      isSupabaseConfigured(
        "https://your-project.supabase.co",
        "your-supabase-anon-key",
      ),
    ).toBe(false);
  });

  it("accepts non-placeholder public project credentials", () => {
    expect(
      isSupabaseConfigured(
        "https://project-id.supabase.co",
        "public-anon-key-value",
      ),
    ).toBe(true);
  });
});
