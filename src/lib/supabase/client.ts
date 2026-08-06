import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "@/lib/supabase/config";

export function createClient() {
  const config = getPublicSupabaseConfig();
  if (!config) {
    throw new Error("Missing public Supabase environment variables.");
  }
  return createBrowserClient(config.url, config.anonKey);
}
