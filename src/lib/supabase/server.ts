import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicSupabaseConfig } from "@/lib/supabase/config";

interface ServerCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

type SetServerCookie = (
  name: string,
  value: string,
  options: CookieOptions,
) => void;

export function writeServerCookies(
  cookiesToSet: readonly ServerCookie[],
  setCookie: SetServerCookie,
): void {
  try {
    cookiesToSet.forEach(({ name, value, options }) => {
      setCookie(name, value, options);
    });
  } catch {
    // Server Components are read-only; Route Handlers can still persist refreshes.
  }
}

export async function createClient() {
  const config = getPublicSupabaseConfig();
  if (!config) {
    throw new Error("Missing public Supabase environment variables.");
  }
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        writeServerCookies(cookiesToSet, (name, value, options) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}
