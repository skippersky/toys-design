import { isUserScopedPath } from "@/lib/export-utils";
import { createClient } from "@/lib/supabase/server";

export const SIGNED_DOWNLOAD_EXPIRY_SECONDS = 300;

export async function getSignedDownloadUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication is required to sign an export.");
  }
  if (!isUserScopedPath(path, user.id)) {
    throw new Error("Export path is outside the authenticated user scope.");
  }

  const { data, error } = await supabase.storage
    .from("exports")
    .createSignedUrl(path, SIGNED_DOWNLOAD_EXPIRY_SECONDS);
  if (error) {
    throw new Error("Unable to create the export download URL.");
  }
  return data.signedUrl;
}
