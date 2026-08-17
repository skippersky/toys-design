export interface PublicSupabaseConfig {
  url: string;
  anonKey: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

const PLACEHOLDER_URL = "https://your-project.supabase.co";
const PLACEHOLDER_ANON_KEY = "your-supabase-anon-key";

export function isSupabaseConfigured(
  url = supabaseUrl,
  anonKey = supabaseAnonKey,
): boolean {
  return (
    url.length > 0 &&
    anonKey.length > 0 &&
    url !== PLACEHOLDER_URL &&
    anonKey !== PLACEHOLDER_ANON_KEY
  );
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}
